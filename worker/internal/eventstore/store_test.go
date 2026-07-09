// worker/internal/eventstore/store_test.go
package eventstore

import "testing"

func TestConnect(t *testing.T) {
	s, err := Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer s.Close()
	if s.js == nil {
		t.Fatal("Connect returned a Store with a nil JetStream context")
	}
}

func TestConnect_BadURL(t *testing.T) {
	_, err := Connect("nats://localhost:1")
	if err == nil {
		t.Fatal("Connect to an unreachable address: want error, got nil")
	}
}
