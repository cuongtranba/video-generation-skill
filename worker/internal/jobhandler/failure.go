// worker/internal/jobhandler/failure.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

// publishFailure appends a RunFailed event for a job that failed at stage,
// for the given project (and, for scene-scoped stages, scene). Per plan
// decision #9, a domain-level failure is a valid terminal state: the caller
// should return nil after this succeeds (ack, no redelivery). Only a
// failure to publish the RunFailed event itself should propagate as an
// error (nothing was durably recorded, so a retry is safe and necessary).
func publishFailure(ctx context.Context, store *eventstore.Store, projectID, stage string, sceneIdx int, cause error) error {
	ev := eventstore.NewRunFailed(projectID, stage, sceneIdx, cause)
	if _, err := store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish RunFailed(stage=%s, project=%s): %w", stage, projectID, err)
	}
	return nil
}
