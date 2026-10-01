import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('../client/public/icon.svg', 'utf8')
const browser = await chromium.launch()
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`)
  writeFileSync(`../client/public/${name}.png`, await page.screenshot())
  await page.close()
}
await browser.close()
