
import {
    AsyncRun,
    withResolvers,
    Wait,
    WaitTimeout,
} from '../src/utils'
import 'jest-extended'



test('utils:AsyncRun', () => {
    AsyncRun(expect('').pass)
})

test('utils:AsyncRun', () => {
    AsyncRun(() => {
        expect('').pass('pass')
    })
})

test('utils:withResolvers', () => {
    let result = withResolvers()
    expect(result.promise).not.toBeNull()
    expect(result.resolve).not.toBeNull()
    expect(result.reject).not.toBeNull()
})

test('utils:withResolvers resolve', async () => {
    let result = withResolvers()
    await result.resolve()
    expect(result.promise).toResolve()
})

test('utils:withResolvers reject', async () => {
    let result = withResolvers()
    await result.reject()
    expect(result.promise).toReject()
})

test('utils:Wait', () => {
    let result = Wait()
    expect(result.length).toBe(2)
    expect(result[0]).not.toBeNull()
    expect(result[1]).toBeFunction()
})

test('utils:Wait resolve', async () => {
    let result = Wait()
    await result[1]()
    expect(result[0]).toResolve()
})



