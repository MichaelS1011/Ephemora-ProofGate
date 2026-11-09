#include <stdio.h>
#include <wasi/api.h>

int main(void) {
    __wasi_fd_t accepted = 0;
    __wasi_errno_t error = __wasi_sock_accept(0, 0, &accepted);
    printf("SOCK_ACCEPT_ERRNO:%u\n", (unsigned)error);

    /* stdin is a pipe, not a socket; Cell grants the guest no network fd. */
    return error == __WASI_ERRNO_NOTSOCK ? 0 : 3;
}
