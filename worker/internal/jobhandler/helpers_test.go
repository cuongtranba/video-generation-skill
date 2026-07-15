//go:build integration

// worker/internal/jobhandler/helpers_test.go
package jobhandler

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/music"
)

// stubMusicSource is a test double for music.MusicSource that records calls
// and delegates to caller-supplied function fields. Naming follows stubRenderer
// in render_test.go.
type stubMusicSource struct {
	searchFn   func(ctx context.Context, q music.Query) ([]music.Track, error)
	downloadFn func(ctx context.Context, track music.Track, dest string) error
}

func (s *stubMusicSource) Search(ctx context.Context, q music.Query) ([]music.Track, error) {
	return s.searchFn(ctx, q)
}

func (s *stubMusicSource) Download(ctx context.Context, track music.Track, dest string) error {
	return s.downloadFn(ctx, track, dest)
}

// newProjectID returns a uuid-suffixed project id so each test run publishes
// to fresh subjects. The VIDGEN_EVENTS 2-minute msgID dupe window would
// otherwise make a re-run with a fixed id fetch the PRIOR run's stored event
// (ordered consumer reads from seq 0), producing spurious path mismatches.
func newProjectID(prefix string) string {
	return prefix + "-" + uuid.NewString()
}

// newTestStore connects to the dev NATS instance used throughout this
// plan's tests (nats://localhost:4223 — see index doc §8; the VIDGEN_EVENTS
// / VIDGEN_JOBS streams already exist there, confirmed while writing this
// plan). Each test uses uuid-suffixed project IDs so runs never collide.
func newTestStore(t *testing.T) *eventstore.Store {
	t.Helper()
	s, err := eventstore.Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// awaitEvent fetches the single most recently stored event for subject and
// decodes it into T. Used to assert on what a handler published.
func awaitEvent[T any](t *testing.T, store *eventstore.Store, subject string) T {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c, err := store.RawJetStream().OrderedConsumer(ctx, eventstore.StreamEvents, jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{subject},
	})
	if err != nil {
		t.Fatalf("ordered consumer for %s: %v", subject, err)
	}

	batch, err := c.Fetch(1, jetstream.FetchMaxWait(3*time.Second))
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}

	var out T
	found := false
	for msg := range batch.Messages() {
		if err := json.Unmarshal(msg.Data(), &out); err != nil {
			t.Fatalf("unmarshal %s: %v", subject, err)
		}
		found = true
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("fetch batch error: %v", err)
	}
	if !found {
		t.Fatalf("no stored event found for subject %s", subject)
	}
	return out
}
