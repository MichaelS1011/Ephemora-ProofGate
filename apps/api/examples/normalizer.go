package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

type result struct {
	Normalized string `json:"normalized"`
	WordCount  int    `json:"wordCount"`
}

func main() {
	inputBytes, err := io.ReadAll(io.LimitReader(bufio.NewReader(os.Stdin), 513))
	if err != nil || len(inputBytes) > 512 {
		fmt.Fprintln(os.Stderr, "input unavailable")
		os.Exit(2)
	}
	input := string(inputBytes)
	normalized := strings.ToLower(strings.Join(strings.Fields(input), " "))
	encoded, err := json.Marshal(result{Normalized: normalized, WordCount: len(strings.Fields(normalized))})
	if err != nil {
		fmt.Fprintln(os.Stderr, "result encoding failed")
		os.Exit(2)
	}
	fmt.Printf("RESULT_JSON:%s\n", encoded)
}
