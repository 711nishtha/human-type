#!/usr/bin/env python3
"""Sample module used by the Human Type test fixtures."""

import sys
from typing import List


def hello(name: str = "world") -> bool:
    """Greet someone.

    A multi-line docstring, so Smart mode has something to keep whole.
    """
    # A line comment with punctuation: (){}[];
    print(f"Hello, {name}!")
    return True


class Greeter:
    def __init__(self, names: List[str]) -> None:
        self.names = names

    def greet_all(self) -> None:
        for n in self.names:
            if n:
                hello(n)
            else:
                sys.stderr.write("empty name\n")


if __name__ == "__main__":
    Greeter(["ada", "alan"]).greet_all()
