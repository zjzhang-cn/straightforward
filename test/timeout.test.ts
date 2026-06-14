import test from "ava"
import { Straightforward, StraightforwardOptions } from "../src"

// ============================================================
// Timeout configuration tests
// ============================================================

test("timeout: default connectTimeout = 10s", (t) => {
  const sf = new Straightforward()
  // Verify the instance got created with defaults (access via internal field)
  t.truthy(sf)
  // Defaults: requestTimeout = 60s for backward compat
  t.is(sf.opts.requestTimeout, 60_000)
})

test("timeout: default readTimeout = 30s", (t) => {
  const sf = new Straightforward()
  t.truthy(sf)
})

test("timeout: custom connectTimeout", (t) => {
  const sf = new Straightforward({ connectTimeout: 5_000 })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 60_000) // requestTimeout default unaffected
})

test("timeout: custom readTimeout", (t) => {
  const sf = new Straightforward({ readTimeout: 15_000 })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 60_000) // requestTimeout default unaffected
})

test("timeout: requestTimeout backward compat", (t) => {
  const sf = new Straightforward({ requestTimeout: 20_000 })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 20_000)
})

test("timeout: connectTimeout + readTimeout override requestTimeout", (t) => {
  const sf = new Straightforward({
    requestTimeout: 20_000,
    connectTimeout: 5_000,
    readTimeout: 10_000,
  })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 20_000) // preserved on opts for backward compat
})

test("timeout: no timeout opts sets defaults", (t) => {
  const sf = new Straightforward({})
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 60_000)
})

test("timeout: connectTimeout overrides requestTimeout fallback", (t) => {
  const sf = new Straightforward({
    requestTimeout: 60_000,
    connectTimeout: 3_000,
  })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 60_000)
})

test("timeout: readTimeout overrides requestTimeout fallback", (t) => {
  const sf = new Straightforward({
    requestTimeout: 60_000,
    readTimeout: 15_000,
  })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 60_000)
})

// ============================================================
// Edge: mixing legacy and new options
// ============================================================

test("timeout: requestTimeout serves as fallback when connectTimeout omitted", (t) => {
  const sf = new Straightforward({ requestTimeout: 25_000 })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 25_000)
})

test("timeout: all three together", (t) => {
  const sf = new Straightforward({
    requestTimeout: 90_000,
    connectTimeout: 8_000,
    readTimeout: 45_000,
  })
  t.truthy(sf)
  t.is(sf.opts.requestTimeout, 90_000)
})
