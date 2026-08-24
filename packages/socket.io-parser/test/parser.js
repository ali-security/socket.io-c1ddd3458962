const { PacketType, Decoder, Encoder, isPacketValid } = require("..");
const expect = require("expect.js");
const helpers = require("./helpers.js");

describe("socket.io-parser", () => {
  it("exposes types", () => {
    expect(PacketType.CONNECT).to.be.a("number");
    expect(PacketType.DISCONNECT).to.be.a("number");
    expect(PacketType.EVENT).to.be.a("number");
    expect(PacketType.ACK).to.be.a("number");
    expect(PacketType.CONNECT_ERROR).to.be.a("number");
    expect(PacketType.BINARY_EVENT).to.be.a("number");
    expect(PacketType.BINARY_ACK).to.be.a("number");
  });

  it("encodes connection", () => {
    return helpers.test({
      type: PacketType.CONNECT,
      nsp: "/woot",
      data: {
        token: "123",
      },
    });
  });

  it("encodes disconnection", () => {
    return helpers.test({
      type: PacketType.DISCONNECT,
      nsp: "/woot",
    });
  });

  it("encodes an event", () => {
    return helpers.test({
      type: PacketType.EVENT,
      data: ["a", 1, {}],
      nsp: "/",
    });
  });

  it("encodes an event (with an integer as event name)", () => {
    return helpers.test({
      type: PacketType.EVENT,
      data: [1, "a", {}],
      nsp: "/",
    });
  });

  it("encodes an event (with ack)", () => {
    return helpers.test({
      type: PacketType.EVENT,
      data: ["a", 1, {}],
      id: 1,
      nsp: "/test",
    });
  });

  it("encodes an ack", () => {
    return helpers.test({
      type: PacketType.ACK,
      data: ["a", 1, {}],
      id: 123,
      nsp: "/",
    });
  });

  it("encodes an connect error", () => {
    return helpers.test({
      type: PacketType.CONNECT_ERROR,
      data: "Unauthorized",
      nsp: "/",
    });
  });

  it("encodes an connect error (with object)", () => {
    return helpers.test({
      type: PacketType.CONNECT_ERROR,
      data: {
        message: "Unauthorized",
      },
      nsp: "/",
    });
  });

  it("throws an error when encoding circular objects", () => {
    const a = {};
    a.b = a;

    const data = {
      type: PacketType.EVENT,
      data: a,
      id: 1,
      nsp: "/",
    };

    const encoder = new Encoder();

    expect(() => encoder.encode(data)).to.throwException();
  });

  it("decodes a bad binary packet", () => {
    try {
      const decoder = new Decoder();
      decoder.add("5");
    } catch (e) {
      expect(e.message).to.match(/Illegal/);
    }
  });

  it("throws an error when receiving too many attachments", () => {
    const decoder = new Decoder({ maxAttachments: 2 });

    expect(() => {
      decoder.add(
        '53-["hello",{"_placeholder":true,"num":0},{"_placeholder":true,"num":1},{"_placeholder":true,"num":2}]',
      );
    }).to.throwException(/^too many attachments$/);
  });

  it("throws an error when receiving too many attachments (default limit)", () => {
    const decoder = new Decoder();
    let decodedCount = 0;

    decoder.on("decoded", () => {
      decodedCount++;
    });

    expect(() => {
      decoder.add('51000000-["hello",{"_placeholder":true,"num":0}]');
    }).to.throwException(/^too many attachments$/);
    expect(decodedCount).to.eql(0);

    // the decoder must not be left waiting for binary attachments
    decoder.add('2["hello"]');
    expect(decodedCount).to.eql(1);
  });

  it("decodes with a custom reviver", () => {
    const decoder = new Decoder((key, value) => {
      if (key === "a") {
        return value.toUpperCase();
      } else {
        return value;
      }
    });

    return new Promise((resolve) => {
      decoder.on("decoded", (packet) => {
        expect(packet.data).to.eql(["b", { a: "VAL" }]);
        resolve();
      });

      decoder.add('2["b",{"a":"val"}]');
    });
  });

  it("decodes with a custom reviver (options object)", () => {
    const decoder = new Decoder({
      reviver: (key, value) => {
        if (key === "a") {
          return value.toUpperCase();
        } else {
          return value;
        }
      },
    });

    return new Promise((resolve) => {
      decoder.on("decoded", (packet) => {
        expect(packet.data).to.eql(["b", { a: "VAL" }]);
        resolve();
      });

      decoder.add('2["b",{"a":"val"}]');
    });
  });

  it("throw an error upon parsing error", () => {
    const isInvalidPayload = (str) =>
      expect(() => new Decoder().add(str)).to.throwException(
        /^invalid payload$/,
      );

    isInvalidPayload('442["some","data"');
    isInvalidPayload('0/admin,"invalid"');
    isInvalidPayload("0[]");
    isInvalidPayload("1/admin,{}");
    isInvalidPayload('2/admin,"invalid');
    isInvalidPayload("2/admin,{}");
    isInvalidPayload('2[{"toString":"foo"}]');
    isInvalidPayload('2[true,"foo"]');
    isInvalidPayload('2[null,"bar"]');
    isInvalidPayload('2["connect"]');
    isInvalidPayload('2["disconnect","123"]');

    expect(() => new Decoder().add("999")).to.throwException(
      /^unknown packet type 9$/,
    );

    expect(() => new Decoder().add(999)).to.throwException(
      /^Unknown type: 999$/,
    );
  });

  it("throw an error upon an invalid attachment count", () => {
    const isInvalidAttachmentCount = (str) =>
      expect(() => new Decoder().add(str)).to.throwException(
        /^Illegal attachments$/,
      );

    isInvalidAttachmentCount("5");
    isInvalidAttachmentCount("51");
    isInvalidAttachmentCount("5a-");
    isInvalidAttachmentCount("51.23-");

    // a packet labeled as binary must declare at least one attachment
    isInvalidAttachmentCount("5-");
    isInvalidAttachmentCount('5-["hello"]');
    isInvalidAttachmentCount('50-["hello"]');
    isInvalidAttachmentCount('50-/admin,["hello"]');
    isInvalidAttachmentCount('50-1["hello"]');
    isInvalidAttachmentCount('6-["hello"]');
    isInvalidAttachmentCount('60-["hello"]');
    isInvalidAttachmentCount('51.23-["hello"]');
    isInvalidAttachmentCount('50-["hello",{"_placeholder":true,"num":0}]');
  });

  it("should not emit a packet when the binary header declares no attachment", () => {
    const decoder = new Decoder();
    let decodedCount = 0;

    decoder.on("decoded", () => {
      decodedCount++;
    });

    const decodePacketWithoutAttachment = () =>
      decoder.add('50-["hello",{"_placeholder":true,"num":0}]');

    expect(decodePacketWithoutAttachment).to.throwException(
      /^Illegal attachments$/,
    );
    expect(decodedCount).to.eql(0);

    // the decoder must not be left waiting for binary attachments
    decoder.add('2["hello"]');
    expect(decodedCount).to.eql(1);
  });

  it("should resume decoding after calling destroy()", () => {
    return new Promise((resolve) => {
      const decoder = new Decoder();

      decoder.on("decoded", (packet) => {
        expect(packet.data).to.eql(["hello"]);
        resolve();
      });

      decoder.add('51-["hello"]');
      decoder.destroy();
      decoder.add('2["hello"]');
    });
  });

  it("should ensure that a packet is valid", () => {
    expect(
      isPacketValid({
        type: 0,
        nsp: "/",
      }),
    ).to.eql(true);

    expect(
      isPacketValid({
        type: 0,
        nsp: "/admin",
        data: "invalid",
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 0,
        nsp: "/",
        data: [],
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 1,
        nsp: "/admin",
        data: {},
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/admin",
        data: "invalid",
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/admin",
        data: {},
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/",
        data: { toString: "foo" },
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/",
        data: [true, "foo"],
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/",
        data: [null, "bar"],
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/",
        data: ["connect"],
      }),
    ).to.eql(false);

    expect(
      isPacketValid({
        type: 2,
        nsp: "/",
        data: ["disconnect", "123"],
      }),
    ).to.eql(false);
  });
});
