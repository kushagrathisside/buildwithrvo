import { test, expect } from '@playwright/test';

test.describe('Playback Viewer & Details Panel', () => {
  test('Selecting an incident populates the Details Panel and starts playback', async ({ page }) => {
    await page.goto('/');

    // Wait for an incident card to appear (timeout 25s to allow for YOLO inference in the background if just starting)
    // To ensure an incident appears, we can trigger a source switch first.
    const sourceSelect = page.locator('select#camera-source');
    await sourceSelect.selectOption('phoneandclear.mp4');

    const incidentCard = page.locator('.incident-card').first();
    await expect(incidentCard).toBeVisible({ timeout: 25000 });

    // Click the card
    await incidentCard.click();

    // Verify Details Panel populates (give time for the fetch to complete)
    await expect(page.locator('.details-panel')).toBeVisible();
    await expect(page.locator('.insight-block').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Avg. Confidence')).toBeVisible();
    
    // Verify Playback Viewer
    const canvas = page.locator('canvas#video-canvas');
    await expect(canvas).toBeVisible();

    // Verify slider is present
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();
    
    // Test that the Play/Pause button exists
    const playPauseBtn = page.locator('#btn-play-pause').first();
    await expect(playPauseBtn).toBeVisible();
  });
});
