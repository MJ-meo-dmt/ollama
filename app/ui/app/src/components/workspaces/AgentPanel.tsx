export function AgentPanel() {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="font-medium dark:text-white">Workspace Agent</h2>

      <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        Mock agent panel. Later this becomes:
        <ul className="mt-2 list-disc pl-5">
          <li>task planning</li>
          <li>file inspection</li>
          <li>patch generation</li>
          <li>diff approval</li>
        </ul>
      </div>

      <button className="mt-4 w-full rounded-lg bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black">
        Start mock task
      </button>
    </section>
  )
}