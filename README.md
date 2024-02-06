<div align="center">
<p align="center">
  <h2>AsyncPool</h2>
  <span>异步并行池</span>
</p>

[![MIT-license](https://img.shields.io/npm/l/code-inspector.svg)](https://opensource.org/licenses/MIT)

</div>

## 特征

- **并行执行任务**
- **自由控制任务执行速率**
- **执行调度暂停恢复**
- **任务重试**
- 支持多种任务形式
  - 单函数处理多条数据
  - 单数据指定执行函数
  - 函数即任务
- 任务添加速率控制
- 任务队列缓存控制
- 任务全部完成事件防抖
- 任务重试次数控制


## Install

```sh
pnpm install AsyncPool
```

## 使用

```javascript
import { AsyncPool } from 'AsyncPool'

const pool = AsyncPool({
    parallel: 2,
    worker: (data)=>console.log(data)
})

pool.addTodo('task#1')
pool.addTodos('task#2', 'task#3')
pool.addWorkerTodo((data)=>console.info(data), 'task#4')
pool.addWorker(()=> console.debug('task#5'))

await pool.waitAllWorkerDone()
```

## 典型场景
### 爬虫
1. 边爬边添加任务，防止任务过度积压
```javascript
while(true){
    if (pool.queueCounts() > 10) await pool.waitParallelIdel()
    pool.addTodo('https://example.com')
}
```
2. 执行速率控制，可自由选择令牌桶进行限速
```javascript
pool.rateLimiter = (resolve)=> {
    // 执行resolve后才会运行一次任务
    resolve()
}
```
3. 网站限频后可暂停整个队列，手动灵活恢复
```javascript
pool.taskResultCallback = ({data,result,error,retry, pool})=>{
    // 任务出现异常
    if(result=='error' || error!=null){
        // 暂停任务队列，并设置恢复回调
        pool.pause((Resolve)=>{
            // 定时检查网站状态，直到正常访问
            while(isBlocking()){
                sleep(1000)
            }
            // 恢复队列执行
            Resolve()
        })
        // 该任务本身重新放入待执行队列
        retry()
    }
}
```
4. 正确响应任务完成事件，避免任务执行快于添加误触发