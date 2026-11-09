#include <ctype.h>
#include <stdio.h>

int main(void) {
    char input[513];
    size_t length = fread(input, 1, sizeof(input) - 1, stdin);
    char normalized[513];
    size_t output = 0;
    int in_space = 1;

    for (size_t i = 0; i < length; i++) {
        unsigned char byte = (unsigned char)input[i];
        if (isspace(byte)) {
            if (!in_space && output < sizeof(normalized) - 1) {
                normalized[output++] = ' ';
            }
            in_space = 1;
        } else {
            if (output < sizeof(normalized) - 1) {
                normalized[output++] = (char)tolower(byte);
            }
            in_space = 0;
        }
    }

    if (output > 0 && normalized[output - 1] == ' ') output--;
    normalized[output] = '\0';
    unsigned word_count = output == 0 ? 0 : 1;
    for (size_t i = 0; i < output; i++) {
        if (normalized[i] == ' ') word_count++;
    }
    printf("RESULT_JSON:{\"normalized\":\"%s\",\"wordCount\":%u}\n", normalized, word_count);
    return 0;
}
