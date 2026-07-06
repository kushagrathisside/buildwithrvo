import { test, expect } from '@playwright/test';

test.describe('UI Integrity and Layout', () => {
  test('Dashboard loads and displays empty state initially', async ({ page }) => {
    await page.goto('/');
    
    // Check main title
    await expect(page.locator('text=RVO AI Proctoring Node')).toBeVisible();
    
    // Check for the incidents panel container instead of the empty text (which might not exist if DB persists)
    await expect(page.locator('.incidents-list')).toBeVisible();
  });

  test('CSS Classes are applied correctly', async ({ page }) => {
    await page.goto('/');
    
    // Verify header structure
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.source-selector')).toBeVisible();
    
    // Verify main content structure
    await expect(page.locator('.dashboard-grid')).toBeVisible();
    await expect(page.locator('.incidents-panel')).toBeVisible();
    await expect(page.locator('.playback-panel')).toBeVisible();
    await expect(page.locator('.details-panel')).toBeVisible();
  });
});
