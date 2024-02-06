import { AsyncPool } from '../src/async-pool'
import 'jest-extended'



test('AsyncPool:AsyncPool', () => {
    const p = new AsyncPool()
    p.addWorker(() => {
        expect('').pass('pass')
    })
})