package main

import (
	"fmt"
	"os"
)

// Greeter holds names to greet.
type Greeter struct {
	Names []string
}

/* Block comment for the method below. */
func (g *Greeter) GreetAll() error {
	for _, n := range g.Names {
		if n == "" {
			return fmt.Errorf("empty name")
		}
		fmt.Fprintf(os.Stdout, "Hello, %s!\n", n)
	}
	return nil
}

func main() {
	g := &Greeter{Names: []string{"ada", "alan"}}
	if err := g.GreetAll(); err != nil {
		os.Exit(1)
	}
}
