import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeFunctionData,
  encodeAbiParameters,
  decodeFunctionData,
  zeroAddress,
  erc20Abi,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import { DatabaseSync } from "node:sqlite";
import {
  mainnetRouterAbi,
  simpleSwapParameters,
  KYBER_ROUTER,
  validateMainnetPlan,
  type MainnetPlan,
} from "../src/server/stocks/mainnet-trade";
import { MAINNET_ASSETS, MAINNET_QUOTE } from "../src/server/networks/chain";
import {
  mainnetConfirmationReply,
  migrateMainnetOrders,
  orderDigest,
} from "../src/server/stocks/mainnet-orders";
const executor = "0x1111111111111111111111111111111111111111" as Address;
const wallet = "0x2222222222222222222222222222222222222222" as Address;
process.env.MAINNET_KYBER_EXECUTOR = executor;
process.env.MAINNET_KYBER_EXECUTOR_CODEHASH = "0x" + "11".repeat(32);
process.env.MAINNET_ROUTER_CODEHASH = "0x" + "22".repeat(32);
process.env.PRIVY_MAINNET_POLICY_ID = "test-policy";
process.env.MAINNET_MAX_USDT_PER_TRADE = "10";
process.env.MAINNET_MAX_FEE_WEI = "1000000000000000";
function plan(): MainnetPlan {
  const id = "11111111-1111-4111-8111-111111111111",
    deadline = Math.floor(Date.now() / 1000) + 200;
  const orderId = keccak256(toBytes(`steward-mainnet-v1:${wallet.toLowerCase()}:${id}`));
  return {
    id,
    orderId,
    wallet,
    router: KYBER_ROUTER,
    symbol: "TSLA",
    side: "buy",
    inputToken: MAINNET_QUOTE.address,
    outputToken: MAINNET_ASSETS.TSLA.variants[0].address,
    amountIn: "1000000",
    expectedOutput: "10000000000000000",
    minimumOutput: "9900000000000000",
    deadline,
    steps: [
      {
        kind: "approve",
        to: MAINNET_QUOTE.address,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [KYBER_ROUTER, 1000000n],
        }),
        gas: "100000",
        gasPrice: "1000000",
      },
      {
        kind: "trade",
        to: KYBER_ROUTER,
        data: encodeFunctionData({
          abi: mainnetRouterAbi,
          functionName: "swap",
          args: [
            {
              callTarget: executor,
              approveTarget: zeroAddress,
              targetData: encodeAbiParameters(simpleSwapParameters, [
                {
                  firstPools: [executor],
                  firstSwapAmounts: [1000000n],
                  swapDatas: ["0x1234"],
                  deadline: BigInt(deadline),
                  positiveSlippageData: "0x",
                },
              ]),
              desc: {
                srcToken: MAINNET_QUOTE.address,
                dstToken: MAINNET_ASSETS.TSLA.variants[0].address,
                srcReceivers: [],
                srcAmounts: [],
                feeReceivers: [],
                feeAmounts: [],
                dstReceiver: wallet,
                amount: 1000000n,
                minReturnAmount: 9900000000000000n,
                flags: 32n,
                permit: "0x",
              },
              clientData: "0x",
            },
          ],
        }),
        gas: "2000000",
        gasPrice: "1000000",
      },
    ],
  };
}
test("valid unsigned mainnet plan passes structural checks", () =>
  assert.doesNotThrow(() => validateMainnetPlan(plan())));
test("rejects recipient, pair, amount, minimum, order and fee mutations", () => {
  const mutate: ((p: MainnetPlan) => void)[] = [
    (p) => {
      p.wallet = executor;
    },
    (p) => {
      p.outputToken = MAINNET_QUOTE.address;
    },
    (p) => {
      p.amountIn = "11000000";
    },
    (p) => {
      p.minimumOutput = "1";
    },
    (p) => {
      p.deadline++;
    },
    (p) => {
      p.steps[1].to = wallet;
    },
    (p) => {
      p.steps[0].gasPrice = "99999999999999999";
    },
    (p) => {
      p.steps[0].data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [wallet, 1000000n],
      });
    },
    (p) => {
      p.steps[0].data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [KYBER_ROUTER, 2n ** 256n - 1n],
      });
    },
  ];
  for (const change of mutate) {
    const p = plan();
    change(p);
    assert.throws(() => validateMainnetPlan(p));
  }
});
test("unknown executor flags are refused even if the outer amounts are correct", () => {
  const p = plan();
  const call = decodeFunctionData({ abi: mainnetRouterAbi, data: p.steps[1].data });
  const e = call.args[0];
  p.steps[1].data = encodeFunctionData({
    abi: mainnetRouterAbi,
    functionName: "swap",
    args: [{ ...e, desc: { ...e.desc, flags: 1024n } }],
  });
  assert.throws(() => validateMainnetPlan(p), /unsupported_kyber_route_encoding/);
});
function dbFor(state = "review", expires = Date.now() + 60000) {
  const db = new DatabaseSync(":memory:");
  migrateMainnetOrders(db);
  db.prepare(
    "INSERT INTO wa_mainnet_orders(id,account_id,sender,recipient,source_message,payload,state,created,expires,confirmation_hash,reply_until) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "11111111-1111-4111-8111-111111111111",
    "account",
    "sender",
    "encrypted",
    "source",
    "encrypted",
    state,
    Date.now(),
    expires,
    orderDigest("a".repeat(48)),
    Date.now() + 60000,
  );
  return db;
}
test("cancel consumes a review once and cannot queue a trade", () => {
  const db = dbFor();
  try {
    const input = "mainstock:cancel:11111111-1111-4111-8111-111111111111:" + "a".repeat(48);
    mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "one");
    assert.equal(
      (db.prepare("SELECT state FROM wa_mainnet_orders").get() as { state: string }).state,
      "cancelled",
    );
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "two").text.body,
      /expired or was used/,
    );
  } finally {
    db.close();
  }
});
test("wrong account and expired buttons cannot authorize", () => {
  const db = dbFor("review", Date.now() - 1);
  try {
    const input = "mainstock:confirm:11111111-1111-4111-8111-111111111111:" + "a".repeat(48);
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "other", input, "one").text.body,
      /expired or was used/,
    );
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "two").text.body,
      /Quote expired/,
    );
  } finally {
    db.close();
  }
});
test("disabled environment flag prevents trade confirmation", () => {
  process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
  const db = dbFor();
  try {
    const input = "mainstock:confirm:11111111-1111-4111-8111-111111111111:" + "a".repeat(48);
    assert.match(
      mainnetConfirmationReply(db, Buffer.alloc(32), "account", input, "one").text.body,
      /disabled/,
    );
    assert.equal(
      (db.prepare("SELECT state FROM wa_mainnet_orders").get() as { state: string }).state,
      "review",
    );
  } finally {
    db.close();
    delete process.env.MAINNET_STOCK_TRADING_ENABLED;
  }
});
