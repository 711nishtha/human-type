#include <stdio.h>
#include <string.h>

/* A block comment
   spanning several lines. */
#define MAX_LEN 128

int main(int argc, char **argv) {
    char buf[MAX_LEN] = "Hello, %s!\n";  // trailing line comment
    const char *who = argc > 1 ? argv[1] : "world";

    if (strlen(who) >= MAX_LEN) {
        fprintf(stderr, "name too long\n");
        return 1;
    }

    printf(buf, who);
    return 0;
}
