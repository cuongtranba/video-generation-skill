// worker/internal/eventstore/store.go
package eventstore

import (
	"fmt"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	// StreamEvents is the append-only source-of-truth event log (owned by
	// api/P1; this package only reads/writes to it, never creates it).
	StreamEvents = "VIDGEN_EVENTS"
	// StreamJobs is the work-queue stream api dispatches jobs onto.
	StreamJobs = "VIDGEN_JOBS"

	eventSubjectPrefix = "vidgen.evt"
	jobSubjectPrefix   = "vidgen.job"
)

// JobKind identifies which pipeline stage a job/consumer belongs to.
type JobKind string

const (
	KindMaterial JobKind = "material"
	KindTTS      JobKind = "tts"
	KindCaption  JobKind = "caption"
	KindRender   JobKind = "render"
)

// Store is the worker's only channel to the shared NATS JetStream
// deployment: no direct DB access, per the frozen "no DB coupling" rule
// (docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md §4/D4).
type Store struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// Connect dials url (compose DNS "nats://nats:4222" in production,
// "nats://localhost:4223" for local dev against the running docker-compose
// stack — §8 of the index) and binds a JetStream context to it.
func Connect(url string) (*Store, error) {
	nc, err := nats.Connect(url)
	if err != nil {
		return nil, fmt.Errorf("connect nats %s: %w", url, err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("create jetstream context for %s: %w", url, err)
	}

	return &Store{nc: nc, js: js}, nil
}

// Close releases the underlying NATS connection.
func (s *Store) Close() {
	s.nc.Close()
}
