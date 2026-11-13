use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};
use near_sdk::json_types::U64;

const MAX_JOB_ID_BYTES: usize = 96;
const MAX_EXPIRY_AHEAD_NS: u64 = 30 * 24 * 60 * 60 * 1_000_000_000;
const MAX_ESCROW_YOCTO: u128 = 10_000_000_000_000_000_000_000_000;
const RESOLVER_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Open,
    Releasing,
    Refunding,
    Paid,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct EscrowJob {
    pub job_id: String,
    pub owner_id: AccountId,
    pub beneficiary_id: AccountId,
    pub amount_yocto: String,
    pub expires_at_ns: U64,
    pub status: JobStatus,
    pub receipt_digest: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    verifier_id: AccountId,
    paused: bool,
    jobs: LookupMap<String, EscrowJob>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(verifier_id: AccountId) -> Self {
        Self {
            owner_id: env::predecessor_account_id(),
            verifier_id,
            paused: false,
            jobs: LookupMap::new(&b"proofgate.jobs"[..]),
        }
    }

    #[payable]
    pub fn create_job(
        &mut self,
        job_id: String,
        beneficiary_id: AccountId,
        expires_at_ns: U64,
    ) {
        require!(!self.paused, "Escrow is paused");
        require!(!job_id.is_empty(), "Job ID is required");
        require!(job_id.len() <= MAX_JOB_ID_BYTES, "Job ID is too long");
        require!(
            self.jobs.get(&job_id).is_none(),
            "Job ID has already been used"
        );
        require!(
            beneficiary_id != env::current_account_id(),
            "Contract cannot be its own beneficiary"
        );

        let now = env::block_timestamp();
        let expires_at = expires_at_ns.0;
        require!(expires_at > now, "Expiry must be in the future");
        require!(
            expires_at.saturating_sub(now) <= MAX_EXPIRY_AHEAD_NS,
            "Expiry cannot be more than 30 days away"
        );

        let amount = env::attached_deposit();
        require!(amount.as_yoctonear() > 0, "Escrow deposit must be positive");
        require!(
            amount.as_yoctonear() <= MAX_ESCROW_YOCTO,
            "Escrow deposit cannot exceed 10 NEAR"
        );

        let job = EscrowJob {
            job_id: job_id.clone(),
            owner_id: env::predecessor_account_id(),
            beneficiary_id,
            amount_yocto: amount.as_yoctonear().to_string(),
            expires_at_ns,
            status: JobStatus::Open,
            receipt_digest: None,
        };
        self.jobs.insert(job_id, job);
    }

    /// The verifier account may release only an existing, open escrow before expiry.
    /// ProofGate verifies the Cell report off-chain; this contract records its digest
    /// and enforces the verifier authority and single-use payment transition.
    pub fn release_job(&mut self, job_id: String, receipt_digest: String) -> Promise {
        require!(!self.paused, "Escrow is paused");
        require!(
            env::predecessor_account_id() == self.verifier_id,
            "Only the configured verifier can release payment"
        );
        require!(valid_digest(&receipt_digest), "Receipt digest must be sha256 hex");

        let mut job = self.open_job(&job_id);
        require!(
            env::block_timestamp() < job.expires_at_ns.0,
            "Expired jobs cannot be paid"
        );
        job.status = JobStatus::Releasing;
        job.receipt_digest = Some(receipt_digest);
        let receiver_id = job.beneficiary_id.clone();
        let amount = parse_amount(&job.amount_yocto);
        self.jobs.insert(job_id.clone(), job);

        self.transfer_with_callback(job_id, receiver_id, amount)
    }

    /// The job owner may reclaim the full deposit after expiry if it is still open.
    pub fn refund_expired(&mut self, job_id: String) -> Promise {
        let mut job = self.open_job(&job_id);
        require!(
            env::predecessor_account_id() == job.owner_id,
            "Only the job owner can refund this escrow"
        );
        require!(
            env::block_timestamp() >= job.expires_at_ns.0,
            "Job has not expired"
        );
        job.status = JobStatus::Refunding;
        job.receipt_digest = None;
        let receiver_id = job.owner_id.clone();
        let amount = parse_amount(&job.amount_yocto);
        self.jobs.insert(job_id.clone(), job);

        self.transfer_with_callback(job_id, receiver_id, amount)
    }

    /// NEAR transfer promises complete asynchronously. Restore Open on failure so
    /// a failed transfer can be retried without losing the escrowed balance.
    #[private]
    pub fn on_transfer_complete(&mut self, job_id: String) -> bool {
        let mut job = self
            .jobs
            .get(&job_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown escrow job"));
        require!(
            matches!(job.status, JobStatus::Releasing | JobStatus::Refunding),
            "Job has no pending transfer"
        );

        let transfer_succeeded = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if transfer_succeeded {
            job.status = if job.status == JobStatus::Releasing {
                JobStatus::Paid
            } else {
                JobStatus::Refunded
            };
            self.jobs.insert(job_id, job);
            true
        } else {
            job.status = JobStatus::Open;
            job.receipt_digest = None;
            self.jobs.insert(job_id, job);
            false
        }
    }

    pub fn set_verifier(&mut self, verifier_id: AccountId) {
        self.assert_owner();
        self.verifier_id = verifier_id;
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    pub fn get_job(&self, job_id: String) -> Option<EscrowJob> {
        self.jobs.get(&job_id).cloned()
    }

    pub fn get_configuration(&self) -> Configuration {
        Configuration {
            owner_id: self.owner_id.clone(),
            verifier_id: self.verifier_id.clone(),
            paused: self.paused,
        }
    }

    fn open_job(&self, job_id: &str) -> EscrowJob {
        let job = self
            .jobs
            .get(job_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown escrow job"));
        require!(job.status == JobStatus::Open, "Job is not open");
        job
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the contract owner can change configuration"
        );
    }

    fn transfer_with_callback(
        &self,
        job_id: String,
        receiver_id: AccountId,
        amount: NearToken,
    ) -> Promise {
        let callback_args = near_sdk::serde_json::to_vec(&CallbackArgs { job_id })
            .unwrap_or_else(|_| env::panic_str("Could not encode transfer callback"));
        Promise::new(receiver_id)
            .transfer(amount)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_transfer_complete".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                RESOLVER_GAS,
            ))
    }
}

#[near(serializers = [json])]
pub struct Configuration {
    pub owner_id: AccountId,
    pub verifier_id: AccountId,
    pub paused: bool,
}

#[near(serializers = [json])]
struct CallbackArgs {
    job_id: String,
}

fn valid_digest(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn parse_amount(value: &str) -> NearToken {
    let yocto = value
        .parse::<u128>()
        .unwrap_or_else(|_| env::panic_str("Stored escrow amount is invalid"));
    NearToken::from_yoctonear(yocto)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{test_vm_config, testing_env, RuntimeFeesConfig};
    use near_sdk::PromiseResult;
    use std::collections::HashMap;

    fn account(value: &str) -> AccountId {
        value.parse().expect("valid NEAR account")
    }

    fn set_context(predecessor: &str, deposit: u128, timestamp: u64) {
        let context = VMContextBuilder::new()
            .current_account_id(account("escrow.testnet"))
            .signer_account_id(account(predecessor))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(timestamp)
            .build();
        testing_env!(context);
    }

    fn contract() -> Contract {
        set_context("owner.testnet", 0, 1_000);
        Contract::new(account("verifier.testnet"))
    }

    const SHA256_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn creates_a_funded_single_use_job() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-001".to_string(), account("agent.testnet"), U64(2_000));

        let job = contract.get_job("PG-001".to_string()).expect("job stored");
        assert_eq!(job.owner_id, account("owner.testnet"));
        assert_eq!(job.amount_yocto, "500");
        assert_eq!(job.status, JobStatus::Open);
    }

    #[test]
    fn only_the_verifier_can_prepare_a_payout() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-002".to_string(), account("agent.testnet"), U64(2_000));

        set_context("verifier.testnet", 0, 1_500);
        let _promise = contract.release_job("PG-002".to_string(), SHA256_A.to_string());
        let job = contract.get_job("PG-002".to_string()).expect("job stored");
        assert_eq!(job.status, JobStatus::Releasing);
        assert_eq!(job.receipt_digest.as_deref(), Some(SHA256_A));
    }

    #[test]
    #[should_panic(expected = "Only the configured verifier can release payment")]
    fn rejects_payouts_from_an_untrusted_account() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-003".to_string(), account("agent.testnet"), U64(2_000));

        set_context("attacker.testnet", 0, 1_500);
        let _promise = contract.release_job("PG-003".to_string(), SHA256_A.to_string());
    }

    #[test]
    #[should_panic(expected = "Job is not open")]
    fn refuses_a_second_payout_while_transfer_is_pending() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-004".to_string(), account("agent.testnet"), U64(2_000));
        set_context("verifier.testnet", 0, 1_500);
        let _first = contract.release_job("PG-004".to_string(), SHA256_A.to_string());
        let _second = contract.release_job("PG-004".to_string(), SHA256_A.to_string());
    }

    #[test]
    fn expired_job_returns_to_its_owner() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-005".to_string(), account("agent.testnet"), U64(2_000));
        set_context("owner.testnet", 0, 2_000);
        let _promise = contract.refund_expired("PG-005".to_string());
        let job = contract.get_job("PG-005".to_string()).expect("job stored");
        assert_eq!(job.status, JobStatus::Refunding);
        assert_eq!(job.owner_id, account("owner.testnet"));
    }

    #[test]
    fn successful_transfer_is_finalized_as_paid() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-008".to_string(), account("agent.testnet"), U64(2_000));
        set_context("verifier.testnet", 0, 1_500);
        let _promise = contract.release_job("PG-008".to_string(), SHA256_A.to_string());

        let callback_context = VMContextBuilder::new()
            .current_account_id(account("escrow.testnet"))
            .signer_account_id(account("escrow.testnet"))
            .predecessor_account_id(account("escrow.testnet"))
            .build();
        testing_env!(
            callback_context,
            test_vm_config(),
            RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![PromiseResult::Successful(vec![])],
        );
        assert!(contract.on_transfer_complete("PG-008".to_string()));
        let job = contract.get_job("PG-008".to_string()).expect("job stored");
        assert_eq!(job.status, JobStatus::Paid);
        assert_eq!(job.receipt_digest.as_deref(), Some(SHA256_A));
    }

    #[test]
    fn failed_transfer_reopens_escrow_without_receipt_claim() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-009".to_string(), account("agent.testnet"), U64(2_000));
        set_context("verifier.testnet", 0, 1_500);
        let _promise = contract.release_job("PG-009".to_string(), SHA256_A.to_string());

        let callback_context = VMContextBuilder::new()
            .current_account_id(account("escrow.testnet"))
            .signer_account_id(account("escrow.testnet"))
            .predecessor_account_id(account("escrow.testnet"))
            .build();
        testing_env!(
            callback_context,
            test_vm_config(),
            RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![PromiseResult::Failed],
        );
        assert!(!contract.on_transfer_complete("PG-009".to_string()));
        let job = contract.get_job("PG-009".to_string()).expect("job stored");
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.receipt_digest, None);
    }

    #[test]
    #[should_panic(expected = "Receipt digest must be sha256 hex")]
    fn rejects_malformed_receipt_digests() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-006".to_string(), account("agent.testnet"), U64(2_000));
        set_context("verifier.testnet", 0, 1_500);
        let _promise = contract.release_job("PG-006".to_string(), "sha256:not-a-digest".to_string());
    }

    #[test]
    #[should_panic(expected = "Escrow deposit cannot exceed 10 NEAR")]
    fn caps_each_escrow_at_ten_near() {
        let mut contract = contract();
        set_context("owner.testnet", MAX_ESCROW_YOCTO + 1, 1_000);
        contract.create_job("PG-010".to_string(), account("agent.testnet"), U64(2_000));
    }

    #[test]
    #[should_panic(expected = "Expired jobs cannot be paid")]
    fn verifier_cannot_release_after_the_job_expires() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-011".to_string(), account("agent.testnet"), U64(2_000));
        set_context("verifier.testnet", 0, 2_000);
        let _promise = contract.release_job("PG-011".to_string(), SHA256_A.to_string());
    }

    #[test]
    #[should_panic(expected = "Job ID has already been used")]
    fn job_ids_cannot_be_reused_after_completion_or_refund() {
        let mut contract = contract();
        set_context("owner.testnet", 500, 1_000);
        contract.create_job("PG-007".to_string(), account("agent.testnet"), U64(2_000));
        contract.create_job("PG-007".to_string(), account("agent.testnet"), U64(2_000));
    }
}
