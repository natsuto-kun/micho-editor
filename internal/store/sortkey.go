package store

import (
	"fmt"
	"strings"
)

// sortAlphabet is [0-9A-Za-z], same ordering as ASCII — keys sort lexicographically.
const sortAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const sortBase = 62
const sortMidIdx = 31 // 'V'

// KeyBetween returns a sort key strictly between lo and hi.
// lo="" means -∞, hi="" means +∞.
// Special case: KeyBetween("","") returns "a0".
func KeyBetween(lo, hi string) (string, error) {
	if lo != "" && hi != "" && lo >= hi {
		return "", fmt.Errorf("KeyBetween: lo %q >= hi %q", lo, hi)
	}
	if lo == "" && hi == "" {
		return "a0", nil
	}
	return lexBetween(lo, hi)
}

func lexBetween(lo, hi string) (string, error) {
	result := make([]byte, 0, max(len(lo), len(hi))+2)
	maxLen := max(len(lo), len(hi))

	for i := 0; i <= maxLen; i++ {
		a := digitAt(lo, i)
		b := hiDigitAt(hi, i)

		mid := (a + b) / 2
		result = append(result, sortAlphabet[mid])

		if mid > a {
			if (a+b)%2 == 1 {
				result = append(result, sortAlphabet[sortMidIdx])
			}
			return string(result), nil
		}

		// mid == a; if mid < b, hi is exhausted for remaining positions
		if mid < b {
			// When lo's digit matches mid but hi's digit is one above, recurse into the next
			// position treating hi as +∞. The loop always terminates on the first iteration
			// because (digitAt(lo,j) + sortBase)/2 > digitAt(lo,j) when lo is exhausted (returns 0).
			for j := i + 1; ; j++ {
				aj := digitAt(lo, j)
				midj := (aj + sortBase) / 2
				result = append(result, sortAlphabet[midj])
				if midj > aj {
					if (aj+sortBase)%2 == 1 {
						result = append(result, sortAlphabet[sortMidIdx])
					}
					return string(result), nil
				}
			}
		}
		// mid == a == b: same digit in both, continue
	}
	return "", fmt.Errorf("KeyBetween: no midpoint between %q and %q", lo, hi)
}

// digitAt returns the alphabet index of key[i], or 0 if i >= len(key).
func digitAt(key string, i int) int {
	if i >= len(key) {
		return 0
	}
	idx := strings.IndexByte(sortAlphabet, key[i])
	if idx < 0 {
		return 0
	}
	return idx
}

// hiDigitAt returns the alphabet index of key[i], or sortBase if i >= len(key) or key is empty.
func hiDigitAt(key string, i int) int {
	if key == "" || i >= len(key) {
		return sortBase
	}
	idx := strings.IndexByte(sortAlphabet, key[i])
	if idx < 0 {
		return sortBase
	}
	return idx
}
