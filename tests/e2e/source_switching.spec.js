import { test, expect } from '@playwright/test';

test.describe('Source Switching & SSE integration', () => {
  test('Changing video source clears incidents and triggers backend', async ({ page }) => {
    await page.goto('/');

    // Wait for SSE connection to establish
    await expect(page.locator('.incidents-list')).toBeVisible();

    // Clicking switch triggers POST /api/set-source and clears state
    // We must intercept the request BEFORE triggering it
    const requestPromise = page.waitForRequest(request => 
      request.url().includes('/api/set-source') && request.method() === 'POST'
    );

    // Select the phoneandclear.mp4 source
    const sourceSelect = page.locator('select#camera-source');
    await sourceSelect.selectOption('phoneandclear.mp4');
    
    // Playwright selects option automatically fires onChange, wait for the request
    const request = await requestPromise;
    expect(request.postDataJSON().source).toBe('phoneandclear.mp4');

    // Wait for the response
    const response = await request.response();
    expect(response.ok()).toBeTruthy();

    // Verify incidents list is cleared in the UI by checking for the empty state
    const emptyState = page.locator('.empty-state');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });
});
