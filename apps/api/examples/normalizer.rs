use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_err() {
        eprintln!("input unavailable");
        std::process::exit(2);
    }

    let normalized = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let word_count = normalized.split_whitespace().count();

    // ProofGate's API restricts this sample to ASCII letters, digits,
    // whitespace, periods, commas, underscores, and hyphens before execution.
    println!(
        "RESULT_JSON:{{\"normalized\":\"{}\",\"wordCount\":{}}}",
        normalized,
        word_count
    );
}
