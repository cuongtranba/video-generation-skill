package main

import (
	"context"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

func TestPublishResultIsIdempotent(t *testing.T) {
	nc, err := nats.Connect("nats://localhost:4223")
	if err != nil {
		t.Skipf("no local nats: %v", err)
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatalf("jetstream: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	subj := "vidgen.evt.testp.RenderCompleted"
	id := "render-testp-once"
	if _, err := PublishResult(ctx, js, subj, id, []byte(`{"v":1}`)); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	if _, err := PublishResult(ctx, js, subj, id, []byte(`{"v":1}`)); err != nil {
		t.Fatalf("second publish: %v", err)
	}
	got := countSubject(ctx, t, js, subj)
	if got != 1 {
		t.Fatalf("want 1 stored event for subject, got %d", got)
	}
}
