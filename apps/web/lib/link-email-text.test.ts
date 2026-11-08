import { describe, expect, it } from 'vitest'
import { sendCode } from './link'
import { memoryStore } from './store'

describe('link email body', () => {
  it('has the code, the purpose of the address, and the ignore line as three paragraphs', async () => {
    const sent: { text: string }[] = []
    await sendCode('did:plc:alice', 'person@x.test', memoryStore(), { send: async (m) => void sent.push(m) })
    const paragraphs = sent[0]!.text.split('\n\n')
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]).toMatch(/^Your code is \d+\. It expires in 15 minutes\.$/)
    expect(paragraphs[1]).toBe('Your email address is used to notify you of changes to your handle or avatar.')
    expect(paragraphs[2]).toMatch(/^If you did not ask to link this address on .+, ignore this message\.$/)
  })
})
