package bus

import (
	"context"
	"testing"
	"time"
)

type testMsg struct {
	ProjectID string `json:"project_id"`
	Value     int    `json:"value"`
}

func newTestBus(t *testing.T) *Bus {
	t.Helper()
	b, err := NewEmbedded(t.TempDir())
	if err != nil {
		t.Fatalf("NewEmbedded: %v", err)
	}
	t.Cleanup(b.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.EnsureStreams(ctx); err != nil {
		t.Fatalf("EnsureStreams: %v", err)
	}
	return b
}

func TestPublishConsumeRoundTrip(t *testing.T) {
	b := newTestBus(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	want := testMsg{ProjectID: "p1", Value: 42}
	if err := PublishJSON(ctx, b, "vidgen.job.tts.p1.0", want); err != nil {
		t.Fatalf("PublishJSON: %v", err)
	}

	got := make(chan testMsg, 1)
	stop, err := ConsumeJSON(ctx, b, StreamJobs, "tts-worker", "vidgen.job.tts.>", func(ctx context.Context, subject string, m testMsg) error {
		got <- m
		return nil
	})
	if err != nil {
		t.Fatalf("ConsumeJSON: %v", err)
	}
	defer stop()

	select {
	case m := <-got:
		if m != want {
			t.Errorf("got %+v, want %+v", m, want)
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for message")
	}
}

func TestDurableRedelivery(t *testing.T) {
	b := newTestBus(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := PublishJSON(ctx, b, "vidgen.job.render.p2.0", testMsg{ProjectID: "p2", Value: 1}); err != nil {
		t.Fatalf("PublishJSON: %v", err)
	}

	// first consumer takes the message then stops without processing more
	seen := make(chan struct{}, 1)
	stop1, err := ConsumeJSON(ctx, b, StreamJobs, "render-worker", "vidgen.job.render.>", func(ctx context.Context, subject string, m testMsg) error {
		seen <- struct{}{}
		return nil
	})
	if err != nil {
		t.Fatalf("ConsumeJSON 1: %v", err)
	}
	<-seen
	stop1()

	// second message on same durable resumes where the first left off
	if err := PublishJSON(ctx, b, "vidgen.job.render.p2.1", testMsg{ProjectID: "p2", Value: 2}); err != nil {
		t.Fatalf("PublishJSON 2: %v", err)
	}

	got := make(chan testMsg, 1)
	stop2, err := ConsumeJSON(ctx, b, StreamJobs, "render-worker", "vidgen.job.render.>", func(ctx context.Context, subject string, m testMsg) error {
		got <- m
		return nil
	})
	if err != nil {
		t.Fatalf("ConsumeJSON 2: %v", err)
	}
	defer stop2()

	select {
	case m := <-got:
		if m.Value != 2 {
			t.Errorf("value = %d, want 2 (durable should not redeliver acked msg)", m.Value)
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for second message")
	}
}

func TestSubjects(t *testing.T) {
	if got := JobSubject(KindTTS, "proj", 3); got != "vidgen.job.tts.proj.3" {
		t.Errorf("JobSubject = %q", got)
	}
	if got := ResultSubject(KindRender, "proj", 0); got != "vidgen.result.render.proj.0" {
		t.Errorf("ResultSubject = %q", got)
	}
}
