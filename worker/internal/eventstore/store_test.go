// worker/internal/eventstore/store_test.go
package eventstore

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go/jetstream"
)

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

func countEventsForSubject(t *testing.T, s *Store, subject string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c, err := s.js.OrderedConsumer(ctx, StreamEvents, jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{subject},
	})
	if err != nil {
		t.Fatalf("ordered consumer for %s: %v", subject, err)
	}

	n := 0
	batch, err := c.Fetch(10, jetstream.FetchMaxWait(2*time.Second))
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

func TestPublishResult_DedupByMsgID(t *testing.T) {
	s, err := Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer s.Close()

	projectID := "testp-" + uuid.NewString()[:8]
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ev := NewRenderCompleted(projectID, "/data/media/"+projectID+"/out.mp4", 0)

	if _, err := s.PublishResult(ctx, ev); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	if _, err := s.PublishResult(ctx, ev); err != nil {
		t.Fatalf("second publish: %v", err)
	}

	got := countEventsForSubject(t, s, ev.Subject())
	if got != 1 {
		t.Fatalf("want 1 stored event for %s (dedup by msgID %s), got %d", ev.Subject(), ev.MsgID(), got)
	}
}
