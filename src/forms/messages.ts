/**
 * The validation messages the address schemas need — and nothing else.
 *
 * Deliberately its own minimal interface rather than a consuming site's i18n type: a shop's message
 * tree carries dozens of unrelated keys, and the SDK has no business depending on that shape.
 * A site maps its own translations onto these six.
 */
export interface AddressValidationMessages {
    firstNameRequired: string;
    lastNameRequired: string;
    streetRequired: string;
    cityRequired: string;
    postalCodeRequired: string;
    countryRequired: string;
}
