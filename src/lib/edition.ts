/** Build-time UI edition; server authorization is enforced separately. */
export const personalOnly = process.env.NEXT_PUBLIC_NEPTUNE_EDITION === 'personal';
export const campusEdition = process.env.NEXT_PUBLIC_NEPTUNE_EDITION === 'campus';
