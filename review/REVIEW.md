# Redesign review

## Original UI findings

- Pale cards inherited white button text, making several summary numbers almost invisible.
- Fifteen columns pushed client contact and follow-up actions outside the viewport.
- Team and relationship-manager selectors lacked visible labels and consistent styling.
- Decorative serif headings and monospaced table text made the interface feel less like an operational tool.
- “All upcoming” included overdue data, while undated policies could never be reviewed.
- There was no filtered Excel export or custom date range.

## Design choices

White surfaces on soft blue-grey, restrained blue accents, system sans-serif typography, consistent controls, and colour reserved for renewal urgency. The main table shows the fields needed to prioritise work. Full client information and editing are in a keyboard-accessible native dialog. No chart was added because the immediate task is identifying and following up on policies.

## Preview

Open `redesign-preview.html` in a local desktop browser. It contains fictional data and supports filters, pagination and a client-details panel. `import-preview.html` previews the import page. Preview changes are temporary and have no connection to production. Standalone Excel downloads and imports are unavailable; run the Flask application to use these features.

## Deployment

1. Apply the changed Python, template and static files to the existing repository. Include the new `exports.py`.
2. Run the test command from README.md.
3. Review on a staging instance with the existing environment variables.
4. Merge the changes and deploy through the existing Render service.

No database migration, new frontend framework or new production dependency is required. The redesign is prepared on a review branch. Merge and deploy through the existing Render service after completing visual review; publishing the branch does not itself update the production site.

## Verification limits

All 13 backend and Excel regression tests pass. DOM-level interaction checks against the local Flask app also passed: initial load, pagination, custom dates, combined filters, empty results, reset, client details, atomic saves and the undated view. No JavaScript runtime errors occurred. The existing production UI was inspected in a browser. The managed browser blocked local and file preview URLs, so screenshot, responsive-layout and native-dialog visual verification of the redesigned app remain to be completed in a normal browser before deployment. No production policies were changed.
