


/**
 * 把传入的方法包装成异步执行
 * @param f 
 */
export const AsyncRun = async (f: Function, ...args: any[]) => await f?.(...args)


/**
 * Promise.withResolvers polyfill
 * @returns `{ resolve, reject, promise }`
 */
export const withResolvers = <T>() => {
    let a: (value?: T | PromiseLike<T>) => void, b: (reason?: any) => void
    const promise = new Promise<T>((resolve, reject) => {
        // @ts-ignore
        a = resolve
        b = reject
    });
    // @ts-ignore
    return { resolve: a, reject: b, promise }
}

/**
 * 阻塞和放行
 * @returns [promise, resolve]
 */
export const Wait = <T = any>(): [Promise<T>, (value?: T | PromiseLike<T>) => void] => {
    const { promise, resolve, } = withResolvers<T>?.()
    return [promise, resolve]
}

/**
 * 阻塞、放行、拒绝
 * @returns [promise, resolve, reject]
 */
export const Wait3 = <T = any>(): [Promise<T>, (value?: T | PromiseLike<T>) => void, (reason?: any) => void] => {
    const { promise, resolve, reject } = withResolvers<T>?.()
    return [promise, resolve, reject]
}

/**
 * 阻塞和放行，超时后直接放行
 * @param timeout 超时毫秒
 * @returns [promise, resolve]
 */
export const WaitTimeout = <T = any>(timeout: number = 60 * 1000): [Promise<T>, (value?: T | PromiseLike<T>) => void] => {
    const { promise, resolve, } = withResolvers<T>?.()
    setTimeout(resolve, timeout > 2_147_483_647 ? 2_147_483_647 : timeout)
    return [promise, resolve]
}

/**
 * 带有延迟防抖的Promise，在防抖时间内重复resolve会重新计时
 * 
 * timeout为总超时计时，调用`WaitDelay()`后立即开始计时，到期后会强行resolve
 * 
 * @param ms 防抖延迟毫秒
 * @param timeout 最大等待时长，超过后直接resolve，可被`cancel()`刷新计时，timeout必须大于防抖ms才会生效
 * @returns [pend, done, cancel]
 */
export const WaitDelay = (ms: number = 0, timeout: number = -1): [Promise<void>, ((value?: void | PromiseLike<void>) => void), (action?: string) => void] => {
    ms = ms > 0 ? ms : 0
    timeout = timeout > 2_147_483_647 ? 2_147_483_647 : timeout
    const [pend, resolve] = Wait()
    let pending = false
    let t1: any = null
    let t2: any = null

    /**
     * 启动带有防抖的resolve，计时到期后会执行resolve，完结promise
     * 
     * 在延迟时间内再次执行`done()`，会重置计时
     */
    let done = () => {
        cancel()
        t1 = setTimeout(resolve, ms)
        // 只有处于pend状态，才会尝试刷新总超时
        if (pending && t2 == null && timeout >= ms) {
            t2 = setTimeout(resolve, timeout)
        }
    }

    /**
     * 取消执行`done`的防抖计时，如果action!='done'，还会一并取消总超时
     * 
     * 对于总超时取消后，需要再次执行`pend()`或`done()`，才会重新计时
     * @param action 默认为空
     */
    let cancel = (action?: string) => {
        clearTimeout(t1)
        t1 = null
        if (action != 'done') {
            // 不等于done，会重新计时
            clearTimeout(t2)
            t2 = null
        }
    }

    if (t2 == null && timeout >= ms) {
        t2 = setTimeout(resolve, timeout)
    }
    return [pend, done, cancel]
}

/**
 * 带有延迟防抖的Promise，在防抖时间内重复resolve会重新计时
 * 
 * 还有总超时时间，超时后立刻resolve
 * 
 * 与`WaitDelay`不同之处在于，返回的pend是一个方法，只有`pend()`后才开始总超时计时
 * @param ms 防抖延迟毫秒
 * @param timeout 最大等待时长，超过后直接resolve，可被delay刷新计时，timeout必须大于防抖ms才会生效
 * @returns [pend2, done, cancel]
 */
export const WaitDelayPend = (ms: number = 0, timeout: number = -1): [() => Promise<void>, ((value?: void | PromiseLike<void>) => void), (action?: string) => void] => {
    ms = ms > 0 ? ms : 0
    timeout = timeout > 2_147_483_647 ? 2_147_483_647 : timeout
    const [pend, resolve] = Wait()
    let pending = false
    let t1: any = null
    let t2: any = null

    /**
     * 启动带有防抖的resolve，计时到期后会执行resolve，完结promise
     * 
     * 在延迟时间内再次执行`done()`，会重置计时
     */
    let done = () => {
        cancel()
        t1 = setTimeout(resolve, ms)
        // 只有处于pend状态，才会尝试刷新总超时
        if (pending && t2 == null && timeout >= ms) {
            t2 = setTimeout(resolve, timeout)
        }
    }

    /**
     * 取消执行`done`的防抖计时，如果action!='done'，还会一并取消总超时
     * 
     * 对于总超时取消后，需要再次执行`pend()`或`done()`，才会重新计时
     * @param action 默认为空
     */
    let cancel = (action?: string) => {
        clearTimeout(t1)
        if (action != 'done') {
            // 不等于done，会重新计时
            clearTimeout(t2)
            t2 = null
        }
    }

    // 只有pend后，才会启动总超时计时
    const pend2 = () => {
        pending = true
        if (t2 == null && timeout >= ms) {
            t2 = setTimeout(resolve, timeout)
        }
        return pend
    }
    return [pend2, done, cancel]
}

/**
 * 返回一个睡眠一段时间的promise
 * @param ms 睡眠毫秒
 * @returns 
 */
export const sleep = (ms: number) => {
    const [promise, resolve] = Wait()
    setTimeout(resolve, ms)
    return promise
}


/**
 * 判断传入的数据没有值，为null或者为undefined，返回true
 * @param any 
 * @returns 
 */
export const None = (any: any | null | undefined) => {
    return any == null || any == undefined
}

/**
 * 判断传入的数据有值，不为null也不为undefined，返回true
 * @param any 
 * @returns boolean
 */
export const NotNone = (any: any | null | undefined) => {
    return any != null && any != undefined
}
