import { readFile } from 'fs/promises'
import express from 'express'
import rateLimit from 'express-rate-limit'
import morgan from 'morgan'
import cors from 'cors'

const port = process.env.API_PORT || 3000
const trustProxy = process.env.API_TRUST_PROXY === '1'
let cache = {}

const refreshCache = async () => {
  const data = await readFile(new URL('../_cached_request_data.json', import.meta.url), { encoding: 'utf-8' })
  cache = JSON.parse(data)
}

const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true
})

export const startServer = () => {
  const app = express()
  if (trustProxy) app.enable('trust proxy')
  app.use(limiter)
  app.use(morgan('common'))
  app.use(cors())

  app.get('/', (req, res) => res.json(cache))

  refreshCache().finally(() => {
    setInterval(refreshCache, 1000)
    app.listen(port, () => console.log(`Server is listening on http://localhost:${port}`))
  })
}
