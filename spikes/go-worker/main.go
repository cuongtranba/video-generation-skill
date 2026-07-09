package main

import (
	"context"
	"fmt"
	"testing"

	"github.com/nats-io/nats.go/jetstream"
)

// PublishResult publishes a result event to the given subject with a
// stable msgID so that the JetStream stream's dupe-window collapses
// repeated publishes of the same message into a single stored event.
// This replaces the old output-file existence check for idempotency.
func PublishResult(ctx context.Context, js jetstream.JetStream, subject, msgID string, data []byte) (*jetstream.PubAck, error) {
	ack, err := js.Publish(ctx, subject, data, jetstream.WithMsgID(msgID))
	if err != nil {
		return nil, fmt.Errorf("publish result %s: %w", subject, err)
	}
	return ack, nil
}

// countSubject counts how many stored events exist for subject on the
// VIDGEN_EVENTS stream, using an ephemeral ordered consumer filtered to
// that subject.
func countSubject(ctx context.Context, t *testing.T, js jetstream.JetStream, subject string) int {
	t.Helper()
	c, err := js.OrderedConsumer(ctx, "VIDGEN_EVENTS", jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{subject},
	})
	if err != nil {
		t.Fatalf("ordered consumer: %v", err)
	}
	n := 0
	batch, err := c.Fetch(10)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	for range batch.Messages() {
		n++
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("fetch batch error: %v", err)
	}
	return n
}

func main() { fmt.Println("spike: run via go test") }
