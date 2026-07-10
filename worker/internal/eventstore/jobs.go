// worker/internal/eventstore/jobs.go
package eventstore

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	fetchBatchSize = 10
	// fetchMaxWait is tuned low per the D4 checkpoint finding: Fetch(n)
	// against fewer than n available messages otherwise blocks for the
	// default ~30s max-wait. A low value also bounds how long ConsumeJobs
	// takes to notice ctx cancellation and return (worst case: one more
	// in-flight Fetch call), so it doubles as the shutdown-latency budget.
	fetchMaxWait = 2 * time.Second
)

// JobHandler processes one decoded job message of type T. Returning an
// error leaves the message un-acked so JetStream redelivers it — reserved
// for infra failures (e.g. can't publish the result event); domain-level
// failures should be captured as a RunFailed event and the handler should
// then return nil (see plan decision #9 in the P3 plan doc).
type JobHandler[T any] func(ctx context.Context, subject string, job T) error

// ConsumeJobs attaches a durable pull consumer named durable, filtered to
// vidgen.job.<kind>.>, and decodes each fetched message into T before
// invoking handler. It loops fetching small batches with a low
// FetchMaxWait until ctx is cancelled, then returns nil. It does not create
// the VIDGEN_JOBS stream (owned by api/P1) — the stream must already exist.
func ConsumeJobs[T any](ctx context.Context, s *Store, kind JobKind, durable string, handler JobHandler[T]) error {
	stream, err := s.js.Stream(ctx, StreamJobs)
	if err != nil {
		return fmt.Errorf("open stream %s: %w", StreamJobs, err)
	}

	filter := fmt.Sprintf("%s.%s.>", jobSubjectPrefix, kind)
	cons, err := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Durable:        durable,
		FilterSubjects: []string{filter},
		AckPolicy:      jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return fmt.Errorf("create consumer %s on %s: %w", durable, StreamJobs, err)
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		batch, err := cons.Fetch(fetchBatchSize, jetstream.FetchMaxWait(fetchMaxWait))
		if err != nil {
			return fmt.Errorf("fetch batch for consumer %s: %w", durable, err)
		}

		for msg := range batch.Messages() {
			var job T
			if err := json.Unmarshal(msg.Data(), &job); err != nil {
				// malformed payload cannot succeed on redelivery: drop it
				_ = msg.Term()
				continue
			}
			if err := handler(ctx, msg.Subject(), job); err != nil {
				_ = msg.Nak()
				continue
			}
			_ = msg.Ack()
		}
		if err := batch.Error(); err != nil {
			return fmt.Errorf("fetch batch error for consumer %s: %w", durable, err)
		}
	}
}
