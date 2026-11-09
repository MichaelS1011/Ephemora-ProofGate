extern "c" fn getchar() c_int;
extern "c" fn isspace(c_int) c_int;
extern "c" fn tolower(c_int) c_int;
extern "c" fn printf([*:0]const u8, ...) c_int;

pub fn main() void {
    var input_bytes: [512]u8 = undefined;
    var input_length: usize = 0;
    while (input_length < input_bytes.len) {
        const value = getchar();
        if (value < 0) break;
        input_bytes[input_length] = @intCast(value);
        input_length += 1;
    }

    var normalized: [513]u8 = undefined;
    var output_length: usize = 0;
    var in_space = true;
    for (input_bytes[0..input_length]) |byte| {
        if (isspace(@intCast(byte)) != 0) {
            if (!in_space and output_length < normalized.len - 1) {
                normalized[output_length] = ' ';
                output_length += 1;
            }
            in_space = true;
        } else {
            if (output_length < normalized.len - 1) {
                normalized[output_length] = @intCast(tolower(@intCast(byte)));
                output_length += 1;
            }
            in_space = false;
        }
    }
    if (output_length > 0 and normalized[output_length - 1] == ' ') output_length -= 1;
    normalized[output_length] = 0;

    var word_count: c_uint = if (output_length == 0) 0 else 1;
    for (normalized[0..output_length]) |byte| {
        if (byte == ' ') word_count += 1;
    }

    _ = printf(
        "RESULT_JSON:{\"normalized\":\"%s\",\"wordCount\":%u}\n",
        @as([*:0]const u8, @ptrCast(&normalized)),
        word_count,
    );
}
