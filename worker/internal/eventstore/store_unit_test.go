// worker/internal/eventstore/store_unit_test.go
package eventstore

import "testing"

// TestConnect_BadURL verifies that Connect returns an error for an
// unreachable address without requiring a live NATS server.
func TestConnect_BadURL(t *testing.T) {
	_, err := Connect("nats://localhost:1")
	if err == nil {
		t.Fatal("Connect to an unreachable address: want error, got nil")
	}
}
