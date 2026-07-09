// worker/internal/eventstore/jobs_test.go
package eventstore

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

type testJob struct {
	ProjectID string `json:"projectId"`
	SceneIdx  int    `json:"sceneIdx"`
}

func TestConsumeJobs_DecodesAndAcks(t *testing.T) {
	s, err := Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	// t.Cleanup, not a plain defer: VIDGEN_JOBS is a WorkQueue-retention
	// stream that rejects a second consumer with an overlapping filter
	// subject, so the durable consumer this test creates below MUST be
	// deleted (via the t.Cleanup registered further down) before the NATS
	// connection closes, or the delete call fails silently (ignored error)
	// and leaks a consumer that permanently blocks every future run of
	// this test with "filtered consumer not unique on workqueue stream".
	// t.Cleanup funcs run in LIFO order, so registering this one first
	// means it runs LAST, after the DeleteConsumer cleanup below.
	t.Cleanup(s.Close)

	projectID := "testp-" + uuid.NewString()[:8]
	durable := "test-material-" + uuid.NewString()[:8]

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	stream, err := s.js.Stream(ctx, StreamJobs)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	t.Cleanup(func() {
		_ = s.js.DeleteConsumer(context.Background(), StreamJobs, durable)
	})

	subject := fmt.Sprintf("%s.%s.%s.2", jobSubjectPrefix, KindMaterial, projectID)
	want := testJob{ProjectID: projectID, SceneIdx: 2}
	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal job: %v", err)
	}
	if _, err := s.js.Publish(ctx, subject, data); err != nil {
		t.Fatalf("publish job: %v", err)
	}

	consumeCtx, stopConsume := context.WithCancel(context.Background())
	got := make(chan testJob, 1)
	errCh := make(chan error, 1)
	go func() {
		// The durable consumer is filtered by kind only (production
		// behavior — one consumer processes every project's jobs of a
		// given kind), so on the shared dev NATS instance it may also
		// redeliver unrelated material-job backlog left behind by other
		// test runs. Only signal on "got" for the message this test
		// itself published (matched by its uuid-unique projectID);
		// everything else is acked and ignored, same as production would
		// harmlessly process jobs belonging to other projects.
		errCh <- ConsumeJobs(consumeCtx, s, KindMaterial, durable, func(ctx context.Context, subject string, job testJob) error {
			if job.ProjectID == projectID {
				got <- job
			}
			return nil
		})
	}()

	select {
	case job := <-got:
		if job != want {
			t.Fatalf("got job %+v, want %+v", job, want)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("timed out waiting for job to be consumed")
	}

	stopConsume()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("ConsumeJobs returned error after cancel: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ConsumeJobs did not return within 5s of context cancellation")
	}

	_ = stream // keep referenced: consumer is created lazily inside ConsumeJobs itself
}
