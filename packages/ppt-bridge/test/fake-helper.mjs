import fs from 'node:fs'
import process from 'node:process'
import readline from 'node:readline'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? fallback : fallback
}
const mode = value('--mode', 'valid')
const delay = Number(value('--delay', '0'))
const payload = () => {
  const encoded = value('--payload', '')
  if (encoded) return Buffer.from(encoded, 'base64').toString('utf8')
  return JSON.stringify({ state: 'foreground', instanceId: 7001, pptActive: true, inSlideshow: true })
}
let pollCount = 0

const respond = () => {
  pollCount += 1
  if (mode === 'crash') process.exit(17)
  if (mode === 'crash-once') {
    const marker = value('--marker', '')
    if (marker && fs.existsSync(marker)) {
      fs.unlinkSync(marker)
      process.exit(17)
    }
  }
  if (mode === 'malformed') process.stdout.write('{not-json}\n')
  else if (mode === 'invalid') process.stdout.write(JSON.stringify({ state: 'unexpected' }) + '\n')
  else if (mode === 'oversized') process.stdout.write(JSON.stringify({ state: 'foreground', title: 'x'.repeat(1_048_600) }) + '\n')
  else process.stdout.write(payload() + '\n')
}
const onPoll = () => {
  if (mode === 'never') return
  if (mode === 'late') setTimeout(respond, delay || 100)
  else if (mode === 'delay') setTimeout(respond, delay || 20)
  else respond()
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (line.toLowerCase() === 'poll') onPoll()
  else if (line.toLowerCase() === 'exit' && mode !== 'ignore-exit') process.exit(0)
})
if (mode === 'stderr') process.stderr.write('private diagnostic path should not escape\n')
