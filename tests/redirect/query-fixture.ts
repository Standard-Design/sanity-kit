import { evaluate, parse } from 'groq-js'

/** Execute the actual runtime query against fixture documents, including joins. */
export async function redirectQuery(
	query: string,
	params: Record<string, unknown>,
	dataset: unknown[],
) {
	return (
		await evaluate(parse(query), { dataset, params })
	).get() as Promise<unknown>
}
