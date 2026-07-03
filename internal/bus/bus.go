package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	StreamJobs    = "VIDGEN_JOBS"
	StreamResults = "VIDGEN_RESULTS"

	jobSubjectPrefix    = "vidgen.job"
	resultSubjectPrefix = "vidgen.result"

	serverStartTimeout = 10 * time.Second
)

// JobKind identifies the worker type a job or result belongs to.
type JobKind string

const (
	KindTTS      JobKind = "tts"
	KindMaterial JobKind = "material"
	KindCaption  JobKind = "caption"
	KindRender   JobKind = "render"
)

func JobSubject(kind JobKind, projectID string, sceneIdx int) string {
	return fmt.Sprintf("%s.%s.%s.%d", jobSubjectPrefix, kind, projectID, sceneIdx)
}

func ResultSubject(kind JobKind, projectID string, sceneIdx int) string {
	return fmt.Sprintf("%s.%s.%s.%d", resultSubjectPrefix, kind, projectID, sceneIdx)
}

// Bus wraps an embedded NATS server with JetStream, connected in-process.
type Bus struct {
	srv *server.Server
	nc  *nats.Conn
	js  jetstream.JetStream
}

// NewEmbedded starts an in-process NATS server with JetStream persistence in
// storeDir. No TCP port is opened; the client connects in-process only.
func NewEmbedded(storeDir string) (*Bus, error) {
	opts := &server.Options{
		ServerName: "vidgen-embedded",
		DontListen: true,
		JetStream:  true,
		StoreDir:   storeDir,
	}

	srv, err := server.NewServer(opts)
	if err != nil {
		return nil, fmt.Errorf("create embedded nats server: %w", err)
	}

	srv.Start()
	if !srv.ReadyForConnections(serverStartTimeout) {
		srv.Shutdown()
		return nil, fmt.Errorf("embedded nats server not ready after %s", serverStartTimeout)
	}

	nc, err := nats.Connect("", nats.InProcessServer(srv))
	if err != nil {
		srv.Shutdown()
		return nil, fmt.Errorf("connect to embedded nats server: %w", err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		srv.Shutdown()
		return nil, fmt.Errorf("create jetstream context: %w", err)
	}

	return &Bus{srv: srv, nc: nc, js: js}, nil
}

func (b *Bus) Close() {
	b.nc.Close()
	b.srv.Shutdown()
	b.srv.WaitForShutdown()
}

// EnsureStreams creates the JOBS and RESULTS streams if they do not exist.
func (b *Bus) EnsureStreams(ctx context.Context) error {
	streams := []jetstream.StreamConfig{
		{Name: StreamJobs, Subjects: []string{jobSubjectPrefix + ".>"}},
		{Name: StreamResults, Subjects: []string{resultSubjectPrefix + ".>"}},
	}
	for _, cfg := range streams {
		if _, err := b.js.CreateOrUpdateStream(ctx, cfg); err != nil {
			return fmt.Errorf("ensure stream %s: %w", cfg.Name, err)
		}
	}
	return nil
}

// PublishJSON publishes v as JSON to subject on the bus's JetStream.
func PublishJSON[T any](ctx context.Context, b *Bus, subject string, v T) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal message for %s: %w", subject, err)
	}
	if _, err := b.js.Publish(ctx, subject, data); err != nil {
		return fmt.Errorf("publish to %s: %w", subject, err)
	}
	return nil
}

// Handler processes one decoded message; returning an error leaves the
// message un-acked for redelivery.
type Handler[T any] func(ctx context.Context, subject string, msg T) error

// StopFunc stops a running consumer.
type StopFunc func()

// ConsumeJSON attaches a durable consumer to the stream and decodes each
// message into T before invoking the handler. Messages are acked only after
// the handler succeeds.
func ConsumeJSON[T any](ctx context.Context, b *Bus, stream, durable, filterSubject string, handler Handler[T]) (StopFunc, error) {
	s, err := b.js.Stream(ctx, stream)
	if err != nil {
		return nil, fmt.Errorf("open stream %s: %w", stream, err)
	}

	cons, err := s.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Durable:       durable,
		FilterSubject: filterSubject,
		AckPolicy:     jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return nil, fmt.Errorf("create consumer %s on %s: %w", durable, stream, err)
	}

	cc, err := cons.Consume(func(msg jetstream.Msg) {
		var decoded T
		if err := json.Unmarshal(msg.Data(), &decoded); err != nil {
			// malformed payload cannot succeed on redelivery: drop it
			_ = msg.Term()
			return
		}
		if err := handler(ctx, msg.Subject(), decoded); err != nil {
			_ = msg.Nak()
			return
		}
		_ = msg.Ack()
	})
	if err != nil {
		return nil, fmt.Errorf("start consumer %s: %w", durable, err)
	}
	return cc.Stop, nil
}
