export const actions = [
  ["chat", "Ask Sharebloom"],
  ["create", "Create account"],
  ["balance", "View balance"],
  ["send", "Send payment"],
  ["receive", "Receive payment"],
  ["history", "Recent activity"],
  ["contacts", "Manage contacts"],
  ["help", "Help & settings"],
] as const;
export const text = (body: string) => ({ type: "text", text: { body } });
export const capabilities = [
  "Hi, I’m Sharebloom 👋",
  "",
  "📈 Buy and sell Apple, Tesla, NVIDIA and more",
  "🔎 Fairest price across bStocks, Ondo and xStocks",
  "💸 Send, receive and check USDT",
  "",
  "Everything runs on BNB Chain with USDT.",
  "Payments and trades require confirmation.",
].join("\n");
export function onboardingWelcome() {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Hi, I’m Sharebloom 👋\nBuy tokenized US stocks like Apple, Tesla and NVIDIA with USDT on BNB Chain, just by chatting. I compare bStocks, Ondo and xStocks and trade the fairest price.\n\nCreate your account to begin. Trades use real assets and always need your confirmation.",
      },
      action: {
        buttons: [{ type: "reply", reply: { id: "menu:create", title: "Create account" } }],
      },
    },
  };
}
export function menu(hasAccount = false) {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text:
          capabilities +
          (hasAccount
            ? "\n\nChoose a shortcut, or Ask Sharebloom to chat. OpenServ processes chat messages, recent context and task details."
            : "\n\nChoose Create account to begin."),
      },
      action: {
        button: "Open menu",
        sections: [
          {
            title: "Sharebloom",
            rows: actions.map(([id, title]) => ({
              id: "menu:" + id,
              title: id === "create" && hasAccount ? "My account" : title,
            })),
          },
        ],
      },
    },
  };
}
export function actionFor(input: string) {
  const command = input.trim().toLowerCase().replace(/^\//, "");
  if (
    [
      "balance",
      "my balance",
      "check balance",
      "what is my balance",
      "what is my balance?",
      "show my balance",
      "how much do i have",
      "how much do i have?",
    ].includes(command)
  )
    return "balance";
  if (["recent", "activity", "history"].includes(command)) return "history";
  const action = actions.find(
    ([id, label], index) =>
      command === "menu:" + id || command === label.toLowerCase() || command === String(index + 1),
  )?.[0];
  return action;
}
export function reply(input: string) {
  const command = input.trim().toLowerCase().replace(/^\//, "");
  const action = actionFor(input);
  if (action === "create")
    return text(
      "Create your Sharebloom account to get a mainnet wallet. Transactions require your confirmation. Type Menu to begin.",
    );
  if (action === "help" || command === "help")
    return text(
      "Help\n\n• Payments: review, then confirm.\n• Contacts: save names and addresses.\n• Phone payments: recipient lookup must be enabled.\n• Limits: 1,000 USDT per payment.\n\nMainnet payments use real USDT. Never share wallet secrets.\nType Menu to return.",
    );
  if (action === "chat")
    return text("Create your account first, then choose Ask Sharebloom to chat.");
  if (action)
    return text(
      "This feature needs a Sharebloom wallet. Wallet setup is not available yet, and no payment has been prepared or sent. Type Menu to return.",
    );
  return menu();
}
