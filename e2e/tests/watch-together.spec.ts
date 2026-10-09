import { test, expect, devices, type Page } from '@playwright/test'
import { SignJWT } from 'jose'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const JWT_SECRET = 'e2e-jwt-secret-0123456789abcdef'
const OWNER = '00000000-0000-4000-8000-0000000000aa'
const clip = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/clip.webm')
const hostToken = () =>
  new SignJWT({ user_metadata: { full_name: 'Maya' } }).setProtectedHeader({ alg: 'HS256' }).setSubject(OWNER)
    .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))

const videoTime = (p: Page) => p.evaluate(() => document.querySelector('video')!.currentTime)
const videoPlaying = (p: Page) => p.evaluate(() => !document.querySelector('video')!.paused)

/** Autoplay policy may ask for one tap; do it if the overlay shows. */
async function tapIfBlocked(p: Page) {
  const tap = p.getByRole('button', { name: 'Tap to join playback' })
  if (await tap.isVisible().catch(() => false)) await tap.click()
}

// The server allows only a few open rooms per owner and every test hosts as the same user, so close them afterwards.
const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '8080'}`
test.afterEach(async () => {
  const headers = { authorization: `Bearer ${await hostToken()}` }
  const open = (await (await fetch(`${API}/rooms`, { headers })).json()) as Array<{ id: string }>
  await Promise.all(open.map((r) => fetch(`${API}/rooms/${r.id}`, { method: 'DELETE', headers })))
})

// The host always uses a desktop context; the `page` fixture (guest) takes the project's device, so the
// mobile project puts the guest on a phone.
async function startRoom(browser: import('@playwright/test').Browser) {
  const hostCtx = await browser.newContext(devices['Desktop Chrome']) // newContext() would inherit the project's phone emulation
  const host = await hostCtx.newPage()
  const token = await hostToken()
  await host.addInitScript((t) => localStorage.setItem('e2e-token', t), token)
  await host.goto('/dashboard')
  await host.getByLabel('Room name').fill('E2E night')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForURL(/\/r\/.+/)
  const slug = new URL(host.url()).pathname.split('/').pop()!
  await host.locator('input[type=file]').setInputFiles(clip)
  await expect(host.getByRole('button', { name: 'Play' })).toBeVisible()
  return { host, slug, hostCtx }
}

async function joinAsGuest(guest: Page, slug: string, nickname: string) {
  await guest.goto(`/join/${slug}`)
  await guest.getByLabel('Pick a nickname').fill(nickname)
  await guest.getByRole('button', { name: 'Join room' }).click()
  await guest.waitForURL(/\/r\/.+/)
  await guest.locator('input[type=file]').setInputFiles(clip)
  await expect(guest.locator('video')).toBeVisible()
}

test('host and guest stay in sync, and chat works both ways', async ({ browser, page: guest }) => {
  const { host, slug, hostCtx } = await startRoom(browser)
  await joinAsGuest(guest, slug, 'PopcornPat')

  await host.getByRole('button', { name: 'Play' }).click()
  await guest.waitForTimeout(800)
  await tapIfBlocked(guest)
  await expect.poll(() => videoPlaying(guest), { timeout: 8000 }).toBe(true)

  await guest.waitForTimeout(1500)
  expect(Math.abs((await videoTime(host)) - (await videoTime(guest)))).toBeLessThan(0.8)

  // host seeks with the keyboard (three steps forward); guest follows
  const seek = host.getByLabel('Seek')
  await seek.focus()
  for (let i = 0; i < 3; i++) await host.keyboard.press('ArrowRight')
  await guest.waitForTimeout(1500)
  expect(Math.abs((await videoTime(host)) - (await videoTime(guest)))).toBeLessThan(0.8)

  await host.getByLabel('Message').fill('hello from host')
  await host.keyboard.press('Enter')
  await expect(guest.getByText('hello from host')).toBeVisible()
  await guest.getByLabel('Message').fill('hi host')
  await guest.keyboard.press('Enter')
  await expect(host.getByText('hi host')).toBeVisible()

  await hostCtx.close()
})

test('a guest cannot control playback in host-only mode, and a banned guest is removed', async ({ browser, page: guest }) => {
  const { host, slug, hostCtx } = await startRoom(browser)
  await joinAsGuest(guest, slug, 'Sam')
  await expect(guest.getByRole('button', { name: 'Play' })).toHaveCount(0) // no play control for guests

  host.once('dialog', (d) => void d.accept()) // the Ban button asks for confirmation
  await host.getByRole('button', { name: 'Ban' }).click() // desktop: the members list is a side panel, Sam is the only other member
  await expect(guest.getByText('You are banned from this room.')).toBeVisible()
  await hostCtx.close()
})

test('mobile layout: player above chat, no horizontal scroll, 44px touch targets', async ({ browser, page: guest }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone-only assertions')
  const { slug, hostCtx } = await startRoom(browser)
  await joinAsGuest(guest, slug, 'Phone')

  const boxes = await guest.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect()
    return { player: r('.player'), chat: r('.chat'), vw: window.innerWidth, scrollW: document.documentElement.scrollWidth }
  })
  expect(boxes.player.top).toBeLessThan(boxes.chat.top)
  expect(Math.round(boxes.player.width)).toBe(boxes.vw)
  expect(boxes.scrollW).toBeLessThanOrEqual(boxes.vw)

  const tooSmall = await guest.evaluate(() =>
    [...document.querySelectorAll('.btn, .ctl-btn')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ text: el.textContent?.trim() ?? el.getAttribute('aria-label'), h: el.getBoundingClientRect().height }))
      .filter((b) => b.h < 43.5),
  )
  expect(tooSmall).toEqual([])
  await hostCtx.close()
})

test('player controls hide when idle during playback, return on movement, and clicking the picture toggles playback', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'pointer-driven behaviour')
  const { host, hostCtx } = await startRoom(browser)
  // The short fixture clip must not end while we wait.
  await host.evaluate(() => { document.querySelector('video')!.loop = true })
  const controls = host.locator('.controls')
  const paused = () => host.evaluate(() => document.querySelector('video')!.paused)

  await host.getByRole('button', { name: 'Play' }).click() // the button keeps focus: that must NOT pin the bar open
  await host.mouse.move(5, 5)
  await expect(controls).toHaveClass(/hidden/, { timeout: 6000 })
  await expect(controls).toHaveCSS('opacity', '0')
  await expect(controls).toHaveCSS('pointer-events', 'none')

  await host.mouse.move(300, 300)
  await expect(controls).not.toHaveClass(/hidden/)

  await host.mouse.click(300, 300) // click on the picture pauses...
  await expect.poll(paused).toBe(true)
  await host.waitForTimeout(3500)
  await expect(controls).not.toHaveClass(/hidden/) // ...and the bar stays up while paused
  await host.mouse.click(300, 300) // ...and resumes
  await expect.poll(paused).toBe(false)
  await hostCtx.close()
})

test('room layout fits the window: no scrolling video column, member list always visible, player stays 16:9', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout')
  const { host, hostCtx } = await startRoom(browser)
  for (const size of [
    { width: 1914, height: 883 }, // wide and short: the 16:9 player alone is taller than the column
    { width: 1600, height: 700 },
    { width: 1280, height: 720 },
    { width: 1100, height: 600 },
    { width: 1920, height: 1080 },
  ]) {
    await host.setViewportSize(size)
    await host.waitForTimeout(150)
    const r = await host.evaluate(() => {
      const col = document.querySelector('.video-col') as HTMLElement
      const sheet = document.querySelector('.sheet')!.getBoundingClientRect()
      const player = document.querySelector('.player')!.getBoundingClientRect()
      return {
        colScrolls: col.scrollHeight > col.clientHeight + 1,
        sheetTop: sheet.top, sheetBottom: sheet.bottom, vh: window.innerHeight,
        ratio: player.width / player.height, playerW: player.width, colW: col.clientWidth,
      }
    })
    const at = JSON.stringify(size)
    expect(r.colScrolls, `video column scrolls at ${at}`).toBe(false)
    expect(r.sheetTop, `member list top at ${at}`).toBeGreaterThanOrEqual(0)
    expect(r.sheetBottom, `member list bottom at ${at}`).toBeLessThanOrEqual(r.vh + 1)
    expect(Math.abs(r.ratio - 16 / 9), `player ratio at ${at}`).toBeLessThan(0.02)
    expect(r.playerW, `player width at ${at}`).toBeLessThanOrEqual(r.colW + 1)
  }
  await expect(host.getByText('In this room')).toBeInViewport()
  // themed, thin scrollbars instead of the browser's default ones
  const sb = await host.evaluate(() => getComputedStyle(document.querySelector('.msgs')!).scrollbarWidth)
  expect(sb).toBe('thin')
  await hostCtx.close()
})
