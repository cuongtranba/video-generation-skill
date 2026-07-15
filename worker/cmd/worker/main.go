// worker/cmd/worker/main.go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/jobhandler"
	"github.com/cuongtranba/video-generation-skill/worker/internal/material"
	"github.com/cuongtranba/video-generation-skill/worker/internal/music"
	"github.com/cuongtranba/video-generation-skill/worker/internal/prereq"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
	"github.com/cuongtranba/video-generation-skill/worker/internal/tts"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("worker: %v", err)
	}
}

func run() error {
	natsURL := envOrDefault("NATS_URL", "nats://nats:4222")
	envPath := envOrDefault("VIDGEN_ENV_PATH", "/app/.env")
	configPath := envOrDefault("VIDGEN_CONFIG_PATH", "/app/config.yaml")

	checker := prereq.NewChecker()
	if err := checker.Check(); err != nil {
		return fmt.Errorf("check prerequisites: %w", err)
	}
	ffmpegBin, err := checker.Resolve("ffmpeg")
	if err != nil {
		return fmt.Errorf("resolve ffmpeg: %w", err)
	}
	ffprobeBin, err := checker.Resolve("ffprobe")
	if err != nil {
		return fmt.Errorf("resolve ffprobe: %w", err)
	}
	whisperBin, err := checker.Resolve("whisper")
	if err != nil {
		return fmt.Errorf("resolve whisper: %w", err)
	}

	cfg, err := config.Load(envPath)
	if err != nil {
		return fmt.Errorf("load env config %s: %w", envPath, err)
	}
	providers, err := config.LoadProviders(configPath)
	if err != nil {
		return fmt.Errorf("load providers config %s: %w", configPath, err)
	}
	if err := cfg.ValidateForProviders(providers); err != nil {
		return fmt.Errorf("validate provider config: %w", err)
	}

	probe := tts.FFProbeDuration(ffprobeBin)

	ttsKey := cfg.FPTTTSAPIKey
	if providers.TTS.Provider == "elevenlabs" {
		ttsKey = cfg.ElevenLabsAPIKey
	}
	ttsProvider, err := tts.NewFromConfig(providers.TTS, ttsKey)
	if err != nil {
		return fmt.Errorf("build tts provider: %w", err)
	}
	materialSource, err := material.NewFromConfig(providers.Material, cfg)
	if err != nil {
		return fmt.Errorf("build material source: %w", err)
	}
	musicSource, err := music.NewFromConfig(providers.Music, cfg.JamendoClientID)
	if err != nil {
		return fmt.Errorf("build music source: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := eventstore.Connect(natsURL)
	if err != nil {
		return fmt.Errorf("connect eventstore at %s: %w", natsURL, err)
	}
	defer store.Close()

	materialHandler := jobhandler.NewMaterialHandler(materialSource, material.DurationProbe(probe), store)
	ttsHandler := jobhandler.NewTTSHandler(ttsProvider, store)
	captionHandler := jobhandler.NewCaptionHandler(caption.NewWhisperRunner(whisperBin), caption.NewASSWriter(), store)
	renderHandler := jobhandler.NewRenderHandler(render.NewFFmpegRenderer(ffmpegBin, ffprobeBin), musicSource, store)

	type consumer struct {
		kind    eventstore.JobKind
		durable string
		run     func() error
	}
	consumers := []consumer{
		{eventstore.KindMaterial, "worker-material", nil},
		{eventstore.KindTTS, "worker-tts", nil},
		{eventstore.KindCaption, "worker-caption", nil},
		{eventstore.KindRender, "worker-render", nil},
	}
	consumers[0].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindMaterial, "worker-material", materialHandler.Handle)
	}
	consumers[1].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindTTS, "worker-tts", ttsHandler.Handle)
	}
	consumers[2].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindCaption, "worker-caption", captionHandler.Handle)
	}
	consumers[3].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindRender, "worker-render", renderHandler.Handle)
	}

	errCh := make(chan error, len(consumers))
	for _, c := range consumers {
		c := c
		go func() {
			log.Printf("worker: consuming %s jobs (durable=%s)", c.kind, c.durable)
			errCh <- c.run()
		}()
	}

	var errs []error
	for range consumers {
		if err := <-errCh; err != nil {
			errs = append(errs, err)
		}
	}
	log.Print("worker: all consumers stopped, shutting down")
	return errors.Join(errs...)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
