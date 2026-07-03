package main

import (
	"fmt"
	"os"

	"github.com/cuongtranba/video-generation-skill/internal/cli"
)

func main() {
	if err := cli.NewRootCmd().Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "vidgen: %v\n", err)
		os.Exit(1)
	}
}
