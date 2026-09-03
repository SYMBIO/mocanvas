/** Interns string ids to dense u32 engine handles. Handle 0 is reserved. */
export class HandleTable {
  private toHandle = new Map<string, number>()
  private toId: (string | undefined)[] = [undefined]
  private free: number[] = []

  get size(): number {
    return this.toHandle.size
  }

  handle(id: string): number {
    const h = this.toHandle.get(id)
    if (h !== undefined) return h
    const nh = this.free.pop() ?? this.toId.length
    this.toId[nh] = id
    this.toHandle.set(id, nh)
    return nh
  }

  peek(id: string): number | undefined {
    return this.toHandle.get(id)
  }

  id(handle: number): string | undefined {
    return this.toId[handle]
  }

  release(id: string): number | undefined {
    const h = this.toHandle.get(id)
    if (h === undefined) return undefined
    this.toHandle.delete(id)
    this.toId[h] = undefined
    this.free.push(h)
    return h
  }

  clear(): void {
    this.toHandle.clear()
    this.toId = [undefined]
    this.free = []
  }
}
