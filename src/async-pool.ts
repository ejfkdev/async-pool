import { AsyncRun, None, NotNone, Wait, Wait3, WaitDelay, WaitDelayPend } from './utils'


/**
 * 异步任务池
 *
 * 可并行执行多个任务，并限制并行度
 * 待执行的任务可逐步添加，也可以控制任务添加的速度
 *
 * T: task data type
 */
export class AsyncPool<T = any> {
    /**
     * 该异步并发池的名称，仅用于区分不同的实例
     * @default ''
     */
    name = ''
    /**
     * 并行度
     * 
     * 同一时间最多能有多少个任务处于await状态
     * @default 2
     */
    parallel = 2
    /**
     * 当添加新任务后自动启动队列
     * @default true
     */
    autoRun = true
    /**
     * 全局的任务执行者
     * 
     * 如果添加任务数据时没有单独指定worker，则使用该全局woker处理任务数据
     */
    worker: Worker<T> | null = null
    /**
     * 每个任务完成后的回调，可以获取任务返回结果
     */
    taskResultCallback: TaskCallback<T> | null = null
    /**
     * 只在执行任务出现异常被捕获时触发，传入参数与taskResultCallback相同
     */
    taskErrorCallback: TaskCallback<T> | null = null
    /**
     * 任务最多重试次数，如果任务失败重试次数超过该限制，任务数据会被丢弃不再添加到任务队列中
     * @default Number.MAX_SAFE_INTEGER
     */
    maxRetryCount: number = Number.MAX_SAFE_INTEGER

    /** 任务队列 */
    #queue: TaskTodo<T>[] = []
    /**
     * 任务队列缓存上限
     * 
     * 当达到上限时，可使用`await waitParallelIdel()`或`await add*()`来控制任务添加速度
     *
     * 如果不调用上面两个方法则该限制不会有实际作用
     * 
     * @default Number.MAX_SAFE_INTEGER
     */
    queueCacheLimit: number = Number.MAX_SAFE_INTEGER

    /**
     * 等待有空闲额度
     * 
     * 当运行中的woker数量达到parallel数量，会生成此Promise
     * 直到有worker执行完毕产生空闲，此Promise会resolve
     */
    #parallelIdel: PromiseKit = {}

    /**
     * 用于控制parallelIdelPromise最大等待毫秒时间
     * @default -1 一直等待 不超时
     */
    parallelIdelTimeoutMs: number = -1
    /**
     * 等待空闲超时
     */
    #parallelIdelTimeout: PromiseKit = {}

    /**
     * 所有任务完成后的回调，每次队列全部完成后都会触发。如果需要防抖，可使用带有延迟防抖的`DelayPool`
     */
    allWorkerDoneCallback: callback | null = null
    /**
     * 等待
     */
    #allWorkerDone: PromiseKit = {}

    /**
     * 控制任务执行速率方法
     */
    rateLimiter: RateLimiterCallback<T> | null = null

    /** 冻结后恢复 */
    #resume: PromiseKit = {}

    /**
     * 任务队列是否处于运行中
     */
    #running = false
    /**
     * 任务队列执行是否需要停止
     */
    #needBreak = false
    /**
     * 正在处于运行中的任务数量
     */
    #activeWorker = 0

    /**
     * 正在处于运行中的任务数量
     * @returns number
     */
    activeWorkerCounts() {
        return this.#activeWorker
    }
    /**
     * 等待运行的任务队列数量
     * @returns number
     */
    queueCounts() {
        return this.#queue.length
    }

    /**
     * 
     * @param name 该异步并发池的名称，仅用于区分不同的实例。 默认值:''
     * @param parallel 并行度,同一时间最多能有多少个任务处于await状态。 默认值:2
     * @param maxRetryCount 任务最多重试次数，如果任务失败重试次数超过该限制，任务数据会被丢弃不再添加到任务队列中。 默认值:Number.MAX_SAFE_INTEGER
     * @param autoRun 当添加新任务后自动启动队列。 默认值:true
     * @param worker 全局的任务执行者。如果添加任务数据时没有单独指定worker，则使用该全局woker处理任务数据
     * @param taskResultCallback 每个任务完成后的回调，可以获取任务返回结果
     * @param taskErrorCallback 只在执行任务出现异常被捕获时触发
     * @param allWorkerDoneCallback 所有任务完成后的回调，每次队列全部完成后都会触发。如果需要防抖，可使用带有延迟防抖的`DelayPool`
     * @param parallelIdelTimeout 用于控制parallelIdelPromise最大等待毫秒时间。默认值:-1 一直等待 不超时
     * @param rateLimiter 控制任务执行速率方法
     */
    constructor(options: AsyncPoolOptions<T> = {
        name: '',
        parallel: 2,
        maxRetryCount: Number.MAX_SAFE_INTEGER,
        autoRun: true,
        worker: null,
        taskResultCallback: null,
        taskErrorCallback: null,
        allWorkerDoneCallback: null,
        parallelIdelTimeout: -1,
        rateLimiter: null,
    }) {
        this.name = options.name ?? this.name
        options.parallel = options.parallel ?? this.parallel
        this.parallel = options.parallel < 1 ? 1 : options.parallel
        this.autoRun = options.autoRun ?? this.autoRun
        this.worker = options.worker ?? this.worker
        options.maxRetryCount = options.maxRetryCount ?? this.maxRetryCount
        this.maxRetryCount = options.maxRetryCount < 0 ? 0 : options.maxRetryCount
        this.taskResultCallback = options.taskResultCallback ?? this.taskResultCallback
        this.taskErrorCallback = options.taskErrorCallback ?? this.taskErrorCallback
        this.allWorkerDoneCallback = options.allWorkerDoneCallback ?? this.allWorkerDoneCallback
        this.rateLimiter = options.rateLimiter ?? this.rateLimiter
        this.parallelIdelTimeoutMs = options.parallelIdelTimeout ?? this.parallelIdelTimeoutMs
        options.queueCacheLimit = options.queueCacheLimit ?? Number.MAX_SAFE_INTEGER
        this.queueCacheLimit = options.queueCacheLimit < 1 ? 1 : options.queueCacheLimit
    }

    /**
     * 添加任务的通用方法
     * @param items 类型是 TaskTodo<T>
     */
    add(...items: TaskTodo<T>[]) {
        for (const item of items) {
            this.#queue.push(item)
        }
        this.autoRun && this.run()
    }

    /**
     * 添加单个待处理的数据
     * @param data
     * @returns
     */
    addTodo(data: T) {
        this.add({ data })
    }

    /**
     * 添加多个待处理的数据
     * @param data
     * @returns
     */
    addTodos(...datas: T[]) {
        this.add(...datas.map((data) => ({ data })))
    }

    /**
     * 添加待处理的数据和处理该数据的执行方法
     * @param data
     * @param worker 该数据的执行方法
     * @returns
     */
    addWorkerTodo(data: T, worker: Worker) {
        this.add({ data, worker })
    }

    /**
     * 添加多个待处理的数据
     * @param todo
     * @param worker 该数据的执行方法
     * @returns
     */
    addWorkerTodos(worker: Worker, ...datas: T[]) {
        this.add(...datas.map((data) => ({ data, worker })))
    }

    /**
     * 添加待执行的函数
     * @param workerFn 待执行的函数
     * @returns
     */
    addWorker(workerFn: callback) {
        this.add({ workerFn })
    }

    /**
     * 重试任务，有最多次数限制
     * @param task_todo
     * @returns boolean 是否成功添加到队列中
     */
    #reAddTaskTodo(task_todo: TaskTodo, delayMs?: number) {
        task_todo.retryCount = task_todo.retryCount ?? 0
        task_todo.retryCount += 1
        if (task_todo.retryCount > this.maxRetryCount) {
            return false
        }
        if (Number.isInteger(delayMs)) {
            setTimeout(() => {
                this.add(task_todo)
            }, delayMs)
        } else {
            this.add(task_todo)
        }
        return true
    }

    /**
     * 等待所有任务启动并执行完毕
     */
    async waitWorkerDone() {
        await this.#allWorkerDone.Promise ?? null
    }

    /**
     * 从待运行队列取出最早放入的一个任务
     *
     * 当待处理的任务队列为空时，返回null
     * 当运行中的任务达到并行度上限时，会阻塞，直到有空余
     *
     * 如果设置了空闲等待超时，超时后任务队列会停止运行
     *
     * @returns [TaskTodo<T>, boolean] [任务，没有任务]
     */
    async #next() {
        if (this.#queue.length == 0) {
            return [null, true]
        }
        // 如果到达并行上限，等待
        // 限制最大等待时间，超时后会停止任务循环
        if (this.#parallelIdelTimeout.Promise) {
            await Promise.any([this.#waitParallelIdel(true), this.#parallelIdelTimeout.Promise])
            this.#parallelIdelTimeout.Cancel?.()
        } else {
            await this.#waitParallelIdel(true)
        }
        if (this.#needBreak) {
            return [null, true]
        }
        // 返回最早添加的任务数据
        const todo = this.#queue.shift() ?? null
        return [todo, false]
    }

    /**
     * 执行任务
     *
     * @param task_todo
     */
    async #exec(task_todo: TaskTodo<T>) {
        let error: any = null
        let result: any = null
        let { data, worker, workerFn, retryCount } = task_todo
        retryCount = retryCount ?? 0
        try {
            if (workerFn != null) {
                result = await workerFn(this)
            } else {
                const fn = (worker ?? this.worker) as Worker<T>
                if (fn != null) {
                    result = await fn(data as T, { retryCount: retryCount as number, pool: this })
                }
            }
        } catch (e) {
            error = e
        }
        const cbArgs: TaskCallbackArgs<T> = {
            data: data as T,
            result,
            error,
            needBreak: this.#needBreak,
            retryCount,
            retry: () => this.#reAddTaskTodo(task_todo),
            pool: this
        }

        if (error != null) {
            await this.taskErrorCallback?.(cbArgs)
        }

        await this.taskResultCallback?.(cbArgs)
        this.#activeWorker--
        // 空余一个执行额度，触发idel
        if (this.#activeWorker < this.parallel) {
            this.#parallelIdel.Resolve?.()
        }
        if (this.#queue.length == 0 && this.#activeWorker == 0) {
            this.#allWorkerDone.Resolve?.()
            this.allWorkerDoneCallback?.()
            this.#needBreak = false
            this.#allWorkerDone.Promise = null
            this.#allWorkerDone.Resolve = null
        }
    }

    /**
     * 正在运行的任务达到并行度上限时、或任务队列达到缓存上限时会阻塞
     * 直到有空余worker可用
     * 可用来控制添加任务的速度
     */
    waitParallelIdel() {
        return this.#waitParallelIdel()
    }

    /**
     * 等待有空闲并行额度
     * @param next
     * @returns
     */
    #waitParallelIdel(next: any = null) {
        if (None(this.#parallelIdel.Promise) && this.#activeWorker >= this.parallel) {
            ;
            [this.#parallelIdel.Promise, this.#parallelIdel.Resolve] = Wait()
            this.#parallelIdel.Promise = this.#parallelIdel.Promise.then(() => {
                ;
                [this.#parallelIdel.Promise, this.#parallelIdel.Resolve] = [null, null]
            })
        }
        return this.#parallelIdel.Promise
    }

    /**
     * 等待所有任务执行完成
     * @returns
     */
    waitAllWorkerDone() {
        return this.#allWorkerDone.Promise
    }

    /**
     * 等待恢复执行
     * @returns
     */
    waitResume() {
        return this.#resume.Promise ?? null
    }

    /**
     * 暂停任务执行，可以恢复
     * @param resume 恢复方法，(resolve, reject)
     */
    async pause(resumeCallback: ResumeCallback) {
        // 已经在停止中
        if (
            this.#needBreak ||
            NotNone(this.#resume.Promise) ||
            (!(resumeCallback instanceof Promise) && !(resumeCallback instanceof Function))
        ) {
            return false
        }
        ;
        [this.#resume.Promise, this.#resume.Resolve, this.#resume.Reject] = Wait3()
        this.#resume.Promise = this.#resume.Promise
            .then(() => {
                this.#resume = {}
            })
            .catch(() => {
                this.#needBreak = true
                this.#resume = {}
            })
        // 调用自定义的恢复方法
        resumeCallback(this.#resume.Resolve, this.#resume.Reject, this)
        return await this.#resume.Promise
    }

    /** 停止任务继续运行 */
    stop() {
        this.#needBreak = true
    }

    /** 清空任务 */
    clear() {
        this.#running = false
        this.#needBreak = false
        this.#parallelIdel = {}
        this.#allWorkerDone = {}
        this.#resume = {}
        this.#activeWorker = 0
        this.#queue = []
        return true
    }

    async run() {
        // 只保留一个调度
        if (this.#running) {
            return false
        }
        this.#running = true
        this.#needBreak = false

        // 等待空闲额度，超时，超时后停止任务继续运行，触发回调，标记run break
        if (this.parallelIdelTimeoutMs > 0) {
            let PromiseFn: () => Promise<void>
                ;
            [PromiseFn, this.#parallelIdelTimeout.Resolve, this.#parallelIdelTimeout.Cancel] = WaitDelayPend(
                0,
                this.parallelIdelTimeoutMs
            )

            this.#parallelIdelTimeout.PromiseFn = () => PromiseFn().then(() => {
                this.#needBreak = true
            })
        }
        // 所有任务执行完毕事件
        ;[this.#allWorkerDone.Promise, this.#allWorkerDone.Resolve] = Wait()

        while (true) {
            // 如果设置了暂停，需要等待
            await this.waitResume()
            if (this.#needBreak) {
                break
            }
            // 通过控制next返回，来限制并发量
            let [task_todo, none_todo] = (await this.#next()) as [TaskTodo<T>, boolean]
            // 队列中没有取到任务
            if (none_todo) {
                break
            }
            this.#activeWorker++
            // 卡点，主要用于控制执行速率
            await this.#rateLimit(task_todo)
            this.#exec(task_todo)
        }
        this.#needBreak = false
        this.#running = false
        return true
    }

    /**
     * 任务执行限速
     *
     * 在next获取到一个任务数据后，调用此方法进行限速
     * @param task_todo
     * @returns
     */
    #rateLimit(task_todo: TaskTodo<T>) {
        if (this.rateLimiter instanceof Promise || this.rateLimiter instanceof Function) {
            const [pend, done] = Wait()
            AsyncRun(this.rateLimiter, done, task_todo)
            return pend
        }
        return null
    }
}

/**
 * 带有完成防抖和执行超时机制的任务池
 * 
 * 使用场景：当任务生成添加速度慢于任务执行速度，会频繁触发`allWorkerDoneCallback`，此方法内置了防抖功能，可执行`pend()`来等待任务执行完成，可以确保在一段时间内没有新任务添加或完成
 * 
 * 第一次push添加任务时启动总超时。
 * 
 * push新增任务会把done计时和超时都重新计时；
 * pend完成后，再次push任务，会生成新的一轮的pend，可以再次`await pend()`；
 *
 * @param delayMs 防抖延迟，毫秒。默认10秒
 * @param timeout 总限时，push后超过此时间没有任务完成时触发，超时后即使还有任务在执行中，也会直接结束`pend()`的等待状态，timeout必须大于防抖时间才会生效。默认不生效
 *
 * @returns `{ push, pend, cancel }`
 *
 */
export const DelayPool = <T>(
    delayMs: number = 10000,
    timeout: number = -1,
    options?: AsyncPoolOptions<T>
): DelayPoolType<T> => {
    let wait: Promise<void> | null = null
    let done: ResolveNull = null
    let undo: ((action?: string) => void) | null = null
    const p = new AsyncPool<T>({
        ...options,
        allWorkerDoneCallback: async () => {
            // 处于暂停状态不触发done，暂停到期恢复后还会再触发的
            if (p.waitResume() == null) {
                done?.()
                    ;
                [wait, done, undo] = [null, null, null]
            } else {
                cancel()
            }
        },
        taskResultCallback: () => {
            cancel()
        }
    })
    /**
     * 添加任务
     * @param items 任务对象
     */
    const push = async (...items: TaskTodo<T>[]) => {
        // 第一次执行push才初始化delay
        // 否则首次运行而没push导致预期外的超时
        if (wait == null) {
            ;[wait, done, undo] = WaitDelay(delayMs, timeout)
        } else {
            // 添加任务只重置防抖done，不会重置整体超时done，必须有任务执行完成的进度才会重置
            cancel('done')
        }
        await p.add(...items)
    }
    /**
     * 返回一个可以等待的promise对象，只有`push()`之后才会生成该对象
     */
    const pend = async () => { await wait }
    /**
     * 可取消准完成状态和总超时计时
     * @param action 
     */
    const cancel = (action?: string) => { undo?.(action) }
    return { push, pend, cancel }
}


/**
 * 带有延迟完成功能的pool
 */
export type DelayPoolType<T> = {
    /**
     * 添加任务
     * @param items
     * @returns
     */
    push: (...items: TaskTodo<T>[]) => void
    /**
     * 等待所有任务执行完成
     * @returns
     */
    pend: () => Promise<void>

    cancel: (action?: string) => void
}

export type delayPoolOption<T> = {
    parallel?: number
    delayMs?: number
    timeout?: number
    workerErrorCallback?: TaskCallback<T> | null
}

/**
 * 回调方法类型
 */
export type callback<T = any> = (() => T) | (() => Promise<T>)

/**
 * 执行的worker额外的参数
 */
export type WorkerOptions<T> = {
    /**
     * 重试的次数
     */
    retryCount: number
    /**
     * 并发池对象实例
     */
    pool: AsyncPool<T>
}

/**
 * 任务数据的执行方法类型
 * 
 * 第一个数据为传入的data
 * 第二个数据为额外的上下文
 */
export type Worker<T = any> =
    | ((data: T | null | undefined, args: WorkerOptions<T>) => any)
    | ((data: T, args: WorkerOptions<T>) => Promise<any>)

/**
 * 任务本身也可以是一个方法
 */
export type WorkerFn<T = any> =
    | ((pool: AsyncPool<T>) => any)
    | ((pool: AsyncPool<T>) => Promise<any>)

/**
 * 异步任务数据
 * 
 * data: 任务数据
 * worker: 针对该任务的执行方法
 * workerFn: 任务就是方法
 * retry: 该任务重试次数
 */
export type TaskTodo<T = any> = {
    /** 任务数据 */
    data?: T | null
    /** 针对该任务的执行方法 */
    worker?: Worker<T> | null
    /** 任务就是方法 */
    workerFn?: WorkerFn | null
    /** 该任务重试次数，首次执行是0 */
    retryCount?: number
}

/**
 * 任务执行后回调参数类型
 */
export type TaskCallbackArgs<T> = {
    /** 任务处理的数据 */
    data: T
    /** 任务执行结果 */
    result: any
    /** 执行异常数据 */
    error: Error
    /** 执行该回调时，任务循环是否处于需要中断的状态 */
    needBreak: boolean
    /** 该任务重试的次数，从未重试过为0 */
    retryCount: number
    /** 重新排队执行该任务 */
    retry: callback
    /** 异步池对象实例 */
    pool: AsyncPool<T>
}

/**
 * 任务执行后回调方法类型
 */
export type TaskCallback<T> =
    | ((args: TaskCallbackArgs<T>) => any)
    | ((args: TaskCallbackArgs<T>) => Promise<any>)

export type Resolve<T = void> = (value?: T | PromiseLike<T> | undefined) => T
export type Reject = (reason?: any) => void
export type ResolveNull<T = void> = ((value?: T | PromiseLike<T> | undefined) => T) | null
export type RejectNull = ((reason?: any) => void) | null

export type PromiseKit<T = void> = {
    /**
     * 用于等待
     */
    Promise?: Promise<T> | null
    /**
     * 返回Promise等待对象
     */
    PromiseFn?: (() => Promise<T>) | null
    Resolve?: ResolveNull
    Reject?: RejectNull,
    /**
     * 对于带有延迟功能的Promise，用于取消计时
     */
    Cancel?: (action?: string) => void
}

/**
 * 恢复异步池执行的回调方法
 */
export type ResumeCallback =
    | ((resolve: Resolve, reject: Reject, pool: AsyncPool) => any)
    | ((resolve: Resolve, reject: Reject, pool: AsyncPool) => Promise<any>)

/**
 * 控制任务执行速率回调方法
 * 接收两个参数
 * @param done: 放行运行，只有调用该方法后，任务才会继续执行，否则会一直等待
 * @param data: 待执行的任务数据
 */
export type RateLimiterCallback<T> =
    | ((done: Resolve, data: TaskTodo<T>) => void)
    | ((done: Resolve, data: TaskTodo<T>) => Promise<void>)

/**
 * 初始化实例的参数类型
 */
export type AsyncPoolOptions<T> = {
    /** 该异步并发池的名称，仅用于区分不同的实例 */
    name?: string
    /** 并行度，同一时间最多能有多少个任务处于await状态 */
    parallel?: number
    /** 添加任务是否自动执行，默认为true */
    autoRun?: boolean
    /** 任务的全局默认执行方法 */
    worker?: Worker | null
    /** 任务最大重试次数，负数为无限，默认为3 */
    maxRetryCount?: number
    /** 每个任务执行完成后的回调 */
    taskResultCallback?: TaskCallback<T> | null
    /** 任务执行出现异常的回调 */
    taskErrorCallback?: TaskCallback<T> | null
    /** 队列中所有任务完成后的回调 */
    allWorkerDoneCallback?: callback | null
    /** 等待并行额度有空闲的超时时间，超时后所有任务都停止 */
    parallelIdelTimeout?: number
    /** 任务执行频率限制 */
    rateLimiter?: RateLimiterCallback<T> | null
    /** 任务队列最大缓存数量 */
    queueCacheLimit?: number
}