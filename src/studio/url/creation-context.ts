/**
 * A native create intent can carry a suggested folder without writing a URL into
 * its template. The URL field checks this hint, then uses its normal save checks.
 * This is internal coordination data, not stored document content.
 */
import { pagePathname } from '../../url/registry.js'

export interface SanityKitCreationContext {
	readonly version: 1
	readonly mode: 'page' | 'index'
	readonly pathname: string
	readonly schemaType: string
	readonly templateId: string
	readonly pathField: string
}

export interface SanityKitCreationPayload {
	readonly sanityKitCreation: SanityKitCreationContext
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** URL parameters are untrusted; malformed or old hints simply do nothing. */
export function parseSanityKitCreationContext(
	payload: unknown,
): SanityKitCreationContext | undefined {
	if (!record(payload) || !record(payload.sanityKitCreation)) return undefined
	const value = payload.sanityKitCreation
	if (
		value.version !== 1 ||
		(value.mode !== 'page' && value.mode !== 'index') ||
		typeof value.pathname !== 'string' ||
		pagePathname(value.pathname) !== value.pathname ||
		(value.pathname !== '/' &&
			(value.pathname.endsWith('/') || value.pathname.includes('//'))) ||
		typeof value.schemaType !== 'string' ||
		!value.schemaType.trim() ||
		typeof value.templateId !== 'string' ||
		!value.templateId.trim() ||
		typeof value.pathField !== 'string' ||
		!/^([A-Za-z_][A-Za-z0-9_]*\.)+current$/u.test(value.pathField) ||
		value.pathField
			.split('.')
			.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))
	)
		return undefined
	return {
		version: 1,
		mode: value.mode,
		pathname: value.pathname,
		schemaType: value.schemaType,
		templateId: value.templateId,
		pathField: value.pathField,
	}
}

/** A hint must belong to this selected document, template, type, and field. */
export function matchSanityKitCreationContext(
	payload: unknown,
	identity: {
		selectedId: unknown
		selectedType: unknown
		templateId: unknown
		documentId: unknown
		documentType: unknown
		pathField: string
	},
): SanityKitCreationContext | undefined {
	const context = parseSanityKitCreationContext(payload)
	const { selectedId, documentId } = identity
	if (
		!context ||
		typeof selectedId !== 'string' ||
		!selectedId ||
		typeof documentId !== 'string' ||
		!documentId ||
		selectedId.startsWith('versions.') ||
		documentId.startsWith('versions.') ||
		selectedId.replace(/^drafts\./u, '') !==
			documentId.replace(/^drafts\./u, '') ||
		identity.selectedType !== context.schemaType ||
		identity.documentType !== context.schemaType ||
		identity.templateId !== context.templateId ||
		identity.pathField !== context.pathField
	)
		return undefined
	return context
}
