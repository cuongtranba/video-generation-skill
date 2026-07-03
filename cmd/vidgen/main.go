package main

import (
	"fmt"
	"os"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "vidgen: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	fmt.Println("vidgen - Vietnamese short-form video generator (scaffold)")
	return nil
}
