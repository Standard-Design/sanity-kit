/** Native initial-publish transformation shared by the writer and its grant checks.
 * Existing settings still use Actions Publish. This helper mirrors Sanity's
 * mutation publisher without importing private Studio implementation files.
 */
type Row = Readonly<Record<string, unknown>>
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/** Match native mutation publishing, including nested custom reference fields. */
export function initialPublishedCopy(
	draft: Row,
	id: string,
): Record<string, unknown> {
	const copy = structuredClone(draft) as Record<string, unknown>
	const pending: unknown[] = [copy]
	while (pending.length) {
		const value = pending.pop()
		if (Array.isArray(value)) {
			pending.push(...(value as unknown[]))
			continue
		}
		if (!record(value)) continue
		if (typeof value._ref === 'string') {
			if (value._strengthenOnPublish) {
				const keepWeak =
					record(value._strengthenOnPublish) && value._strengthenOnPublish.weak
				delete value._strengthenOnPublish
				if (!keepWeak) delete value._weak
			}
		} else pending.push(...Object.values(value))
	}
	copy._id = id
	delete copy._rev
	delete copy._updatedAt
	return copy
}
