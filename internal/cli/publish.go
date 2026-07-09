package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/publish"
)

func (a *app) newPublishCmd() *cobra.Command {
	var projectID, captionText, privacy string
	var force bool
	cmd := &cobra.Command{
		Use:   "publish",
		Short: "Publish a rendered project's video to the configured platform",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.loadProject(projectID)
			if err != nil {
				return fmt.Errorf("load project %s: %w", projectID, err)
			}
			if p.Status == domain.StatusPublished && !force {
				fmt.Printf("project %s already published; use --force to re-publish\n", p.ID)
				return nil
			}
			if p.Status != domain.StatusRendered && p.Status != domain.StatusPublished {
				return fmt.Errorf("project %s is %q, must be rendered before publish", p.ID, p.Status)
			}
			if p.OutputPath == "" {
				return fmt.Errorf("project %s has no rendered output", p.ID)
			}

			pub, err := publish.NewFromConfig(a.providers.Publish, a.cfg.TikTokAccessToken)
			if err != nil {
				return fmt.Errorf("configure publisher: %w", err)
			}
			res, err := pub.Publish(context.Background(), publish.PublishRequest{
				VideoPath: p.OutputPath,
				Caption:   captionText,
				Privacy:   privacy,
			})
			if err != nil {
				return fmt.Errorf("publish project %s: %w", p.ID, err)
			}

			p.Status = domain.StatusPublished
			if err := a.store.Save(p); err != nil {
				return fmt.Errorf("save project after publish: %w", err)
			}
			if res.URL != "" {
				fmt.Printf("published %s (id %s) %s\n", p.ID, res.PublishID, res.URL)
			} else {
				fmt.Printf("published %s (id %s)\n", p.ID, res.PublishID)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&projectID, "project", "", "project id")
	cmd.Flags().StringVar(&captionText, "caption", "", "post caption/title")
	cmd.Flags().StringVar(&privacy, "privacy", "private", "public | private")
	cmd.Flags().BoolVar(&force, "force", false, "re-publish even if already published")
	return cmd
}
