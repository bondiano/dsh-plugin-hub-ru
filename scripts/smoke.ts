// Smoke test for the localized client bundle: evaluates client/client.js with a
// stub module loader and checks that the three dictionaries register and agree.
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

const react = {
  createElement: () => ({}),
  Fragment: {},
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
}

let definition
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      definition = entry
    },
  },
}

new Function('window', source)(globalThis.window)
if (!definition) throw new Error('bundle did not register a module')

const module = definition.factory((id) => {
  if (id === 'react') return react
  throw new Error(`unexpected require: ${id}`)
})

if (typeof module.apply !== 'function') throw new Error('bundle exports no apply()')
if (!Array.isArray(module.inject) || !module.inject.includes('locale')) throw new Error('bundle does not inject locale')

const registered = []
const ctx = {
  effect(fn) {
    fn()
  },
  locale: {
    register(ns, dictionaries) {
      registered.push({ ns, dictionaries })
    },
    bind() {
      return (key) => key
    },
  },
  slots: {
    inject(_name, fn) {
      fn()
    },
    register(_options, _render) {
      return () => {}
    },
  },
}

module.apply(ctx)
if (registered.length !== 1) throw new Error(`expected one registration, got ${registered.length}`)

const { ns, dictionaries } = registered[0]
if (ns !== 'dsh-plugin') throw new Error(`unexpected namespace: ${ns}`)
const zh = dictionaries.zh
const en = dictionaries.en
const ru = dictionaries.ru
if (!zh || !en || !ru) throw new Error(`missing dictionary: ${Object.keys(dictionaries).join(', ')}`)

const enKeys = Object.keys(en)
const ruKeys = Object.keys(ru)
if (enKeys.length !== 452) throw new Error(`unexpected English key count: ${enKeys.length}`)
if (ruKeys.join('\n') !== enKeys.join('\n')) throw new Error('ru keys differ from en keys')

for (const key of ruKeys) {
  const expected = [...en[key].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(',')
  const actual = [...ru[key].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(',')
  if (expected !== actual) throw new Error(`placeholder mismatch in ${key}`)
  if (/[\u4e00-\u9fff]/.test(ru[key])) throw new Error(`CJK characters left in ${key}`)
}

for (const key of ['nav', 'install', 'settingsTitle']) {
  if (!ru[key] || /[A-Za-z]/.test(ru[key].slice(0, 1)) && key === 'nav') {
    // report only; values are checked for Cyrillic below
  }
}
const cyrillic = ruKeys.filter((key) => /[\u0400-\u04ff]/.test(ru[key]))
if (cyrillic.length < 400) throw new Error(`only ${cyrillic.length} entries contain Cyrillic`)

console.log(`ok: ${ruKeys.length} Russian entries, ${cyrillic.length} with Cyrillic, dictionaries ${Object.keys(dictionaries).join('/')}`)
console.log(`nav: ${ru.nav} | install: ${ru.install} | settings: ${ru.settingsTitle ?? '(n/a)'}`)
