'use client';

import { useState } from 'react';
import { isHoliday, makeAddressSchema, type HolidayRange } from '@adbls/sdk';

// The injection contract: the SDK bundles no language, so the site supplies every message.
// Swap this map for your i18n lookup — the SDK neither knows nor cares which language it is.
const messages = {
    firstNameRequired: 'First name is required',
    lastNameRequired: 'Last name is required',
    streetRequired: 'Street is required',
    cityRequired: 'City is required',
    postalCodeRequired: 'Postal code is required',
    countryRequired: 'Country is required',
};

export default function Home() {
    const [holidays, setHolidays] = useState<HolidayRange[]>([]);
    const [date, setDate] = useState('2026-05-15');
    const [errors, setErrors] = useState<string[]>([]);

    // Note what is NOT here: no api key, no direct call to CORE. The browser talks to our own
    // route handler, which holds the key server-side.
    async function loadHolidays() {
        setHolidays(await fetch('/api/holidays').then((r) => r.json()));
    }

    function validate(form: FormData) {
        const result = makeAddressSchema(messages).safeParse(Object.fromEntries(form));
        setErrors(result.success ? [] : result.error.issues.map((i) => i.message));
    }

    return (
        <main style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 640 }}>
            <h1>Adibilis satellite template</h1>

            <section>
                <h2>Holidays</h2>
                <button onClick={loadHolidays}>Load closure dates</button>
                <input value={date} onChange={(e) => setDate(e.target.value)} />
                <p>
                    {date} is {isHoliday(date, holidays) ? 'a closure day' : 'available'} ({holidays.length} ranges)
                </p>
            </section>

            <section>
                <h2>Address</h2>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        validate(new FormData(e.currentTarget));
                    }}
                >
                    {['firstname', 'lastname', 'address', 'city', 'postalCode'].map((name) => (
                        <input key={name} name={name} placeholder={name} />
                    ))}
                    <button type="submit">Validate</button>
                </form>
                <ul>
                    {errors.map((error) => (
                        <li key={error}>{error}</li>
                    ))}
                </ul>
            </section>
        </main>
    );
}
