const { Cart } = require('../model/CartModel');
const { ObjectId } = require('mongoose').Types;

const { readData, updateData, deleteData } = require('../redis/v1/service/redisService');

const createCart = async ({
  userId,
  productId,
  nameProduct,
  amountProduct,
  imageProduct,
  priceProduct,
  colorProduct,
  discount,
  type,
  totalPrice,
}) => {
  // Validation logic
  if (amountProduct <= 0) throw new Error('amountProduct must be greater than 0');
  if (priceProduct < 0) throw new Error('priceProduct cannot be negative');

  const totalPriceBe = Number(priceProduct) * Number(amountProduct);
  if (totalPriceBe !== totalPrice) {
    console.warn(`Client totalPrice lệch. Ghi đè bằng BE: ${totalPriceBe}`);
  }

  const newCartItem = {
    productId,
    nameProduct,
    amountProduct,
    imageProduct,
    priceProduct,
    colorProduct,
    discount,
    type,
    totalPrice: totalPriceBe,
  };

  try {
    let cart = await Cart.findOne({ userId });

    if (cart) {
      const isProductExist = cart.cartItems.some((item) => item.productId.toString() === productId.toString());
      if (isProductExist) {
        throw new Error('Product already exists in the cart');
      }
      cart.cartItems.push(newCartItem);
      await cart.save();
    } else {
      cart = await Cart.create({
        userId,
        cartItems: [newCartItem],
      });
    }

    // Luôn cập nhật Redis với cấu trúc nhất quán
    const cacheKey = `get-cart-user:${userId}`;
    const responseData = {
      status: 'OK',
      message: 'Success',
      data: cart,
    };

    try {
      await updateData(cacheKey, responseData, 3600);
      console.log(`Cache updated for key: ${cacheKey}`);
    } catch (redisError) {
      console.error('Error updating Redis:', redisError);
    }

    return responseData;
  } catch (error) {
    throw new Error(`Failed to create cart: ${error.message}`);
  }
};

const deleteCart = (id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const cart = await Cart.findOne({ 'cartItems._id': id });
      if (!cart) {
        return resolve({
          status: 'ERR',
          message: 'Cart or cart item does not exist',
        });
      }

      const initialLength = cart.cartItems.length; // 1. Lấy độ dài của cart
      // 2. Filter để tạo mảng mới chỉ chứa những phần tử có _id khác với id được truyền vào
      cart.cartItems = cart.cartItems.filter((item) => item._id.toString() !== id);

      if (initialLength === cart.cartItems.length) {
        return resolve({
          status: 'ERR',
          message: 'Cart item not found in cart',
        });
      }

      // 3. Lưu lại các thay đổi vào database
      await cart.save();

      // Xử lý Redis
      const cacheKey = `get-cart-user:${cart.userId}`;
      const cachedData = await readData(cacheKey).catch(() => null);

      // Log dữ liệu cache để debug
      console.log('Cached data from Redis:', cachedData);

      // Chỉ cập nhật cache nếu đã có cache
      if (cachedData) {
        let updatedCart;

        // Kiểm tra và bỏ "0" nếu tồn tại
        if (cachedData['0']) {
          updatedCart = cachedData['0'];
        } else {
          updatedCart = cachedData;
        }

        // Lấy cartItems từ updatedCart
        let updatedCartItems = updatedCart.cartItems || [];

        // Đảm bảo updatedCartItems là mảng
        if (!Array.isArray(updatedCartItems)) {
          updatedCartItems = [updatedCartItems];
        }

        // Filter cartItems trong cache để loại bỏ item đã xóa
        updatedCartItems = updatedCartItems.filter((item) => item._id.toString() !== id);

        // Cập nhật lại cartItems trong updatedCart
        updatedCart.cartItems = updatedCartItems;
        updatedCart.updatedAt = new Date().toISOString(); // Cập nhật thời gian
        updatedCart.__v = (updatedCart.__v || 0) + 1; // Tăng version

        // Lưu trực tiếp object mà không bao bọc trong "0"
        const dataToUpdate = cachedData['0'] ? { 0: updatedCart } : updatedCart;
        try {
          await updateData(
            cacheKey,
            dataToUpdate,
            3600, // TTL 1 giờ
          );
          console.log(`Cache updated for key: ${cacheKey}`);
        } catch (redisError) {
          console.error('Error updating Redis:', redisError);
        }
      } else {
        console.log('No cache found for key, skipping cache update');
      }

      // Xóa document nếu cartItems rỗng
      if (cart.cartItems.length === 0) {
        await Cart.deleteOne({ _id: cart._id });
        // Xóa cache nếu cart bị xóa
        if (cachedData) {
          try {
            await deleteData(cacheKey);
            console.log(`Cache deleted for key: ${cacheKey}`);
          } catch (redisError) {
            console.error('Error deleting Redis cache:', redisError);
          }
        }
        return resolve({
          status: 'OK',
          message: 'Cart and all items deleted',
          data: null,
        });
      }

      return resolve({
        status: 'OK',
        message: 'Delete cart item success',
        data: cart,
      });
    } catch (e) {
      console.error('Error in deleteCart service:', e);
      reject(e);
    }
  });
};

const getCartUser = async (userId) => {
  try {
    // Kiểm tra Redis trước
    const cacheKey = `get-cart-user:${userId}`;
    const cachedData = await readData(cacheKey).catch((err) => {
      console.error('Redis read error:', err);
      return null;
    });

    if (cachedData && cachedData.status === 'OK') {
      console.log('Serving from Redis:', cacheKey);
      return cachedData; // Trả về dữ liệu đã có cấu trúc
    }

    // Nếu không có trong Redis hoặc dữ liệu không hợp lệ, lấy từ DB
    const userCart = await Cart.findOne({ userId });
    if (!userCart) {
      return {
        status: 'ERR',
        message: 'No cart found for this user',
      };
    }

    const response = {
      status: 'OK',
      message: 'Success',
      data: userCart,
    };

    // Cập nhật Redis sau khi lấy từ DB
    try {
      await updateData(cacheKey, response, 3600);
      console.log(`Cache created/updated for key: ${cacheKey}`);
    } catch (redisError) {
      console.error('Error updating Redis:', redisError);
    }

    return response;
  } catch (error) {
    console.error('getCartUser error:', error);
    throw error;
  }
};

const deleteManyCart = (ids) => {
  return new Promise(async (resolve, reject) => {
    try {
      const objectIds = ids.map((id) => new ObjectId(id));

      // 1. Tìm các cart chứa những cartItems cần xóa
      const carts = await Cart.find({ 'cartItems._id': { $in: objectIds } });

      if (carts.length === 0) {
        return resolve({
          status: 'OK',
          message: 'No cart items found to delete',
        });
      }

      // 2. Xóa cartItems khỏi DB
      const result = await Cart.updateMany(
        { 'cartItems._id': { $in: objectIds } },
        { $pull: { cartItems: { _id: { $in: objectIds } } } },
      );

      // 3. Cập nhật Redis cho từng cart liên quan
      for (const cart of carts) {
        const updatedCart = await Cart.findOne({ _id: cart._id });

        const cacheKey = `get-cart-user:${cart.userId}`;

        if (!updatedCart || updatedCart.cartItems.length === 0) {
          // Nếu giỏ trống, xóa DB và cache
          await Cart.deleteOne({ _id: cart._id });
          await deleteData(cacheKey);
          console.log(`Cart empty -> deleted cache: ${cacheKey}`);
        } else {
          // Nếu còn item, cập nhật lại cache
          const responseData = {
            status: 'OK',
            message: 'Success',
            data: updatedCart,
          };
          await updateData(cacheKey, responseData, 3600);
          console.log(`Updated cache for: ${cacheKey}`);
        }
      }

      resolve({
        status: 'OK',
        message: `Deleted ${result.modifiedCount} cart items successfully`,
      });
    } catch (e) {
      reject({
        status: 'ERR',
        message: e.message,
      });
    }
  });
};

const updateCart = async (userId, productId, amountProduct, clientTotalPrice) => {
  const cart = await Cart.findOne({ userId });
  if (!cart) throw new Error('Cart not found');

  const itemIndex = cart.cartItems.findIndex((item) => item.productId.toString() === productId.toString());
  if (itemIndex === -1) throw new Error('Product not found in cart');

  const item = cart.cartItems[itemIndex];

  // Tính lại totalPrice ở BE
  const calculatedTotal = item.priceProduct * amountProduct;

  // So sánh nếu client gửi sai giá thì dùng giá đúng của BE
  if (clientTotalPrice !== calculatedTotal) {
    console.warn(`Client totalPrice lệch. Ghi đè bằng BE: ${calculatedTotal}`);
  }

  cart.cartItems[itemIndex].amountProduct = amountProduct;
  cart.cartItems[itemIndex].totalPrice = calculatedTotal;
  cart.markModified('cartItems');

  await cart.save();

  // Cập nhật Redis
  const cacheKey = `get-cart-user:${userId}`;
  const cachedData = await readData(cacheKey).catch(() => null);

  if (cachedData) {
    const updatedCart = {
      status: 'OK',
      message: 'Success',
      data: {
        _id: cart._id,
        userId: cart.userId,
        cartItems: cart.cartItems, // Chỉ dùng một mảng cartItems
        createdAt: cart.createdAt,
        updatedAt: new Date().toISOString(),
        __v: cart.__v,
      },
    };

    try {
      await updateData(cacheKey, updatedCart, 3600);
      console.log(`Cache updated for key: ${cacheKey}`);
    } catch (redisError) {
      console.error('Error updating Redis:', redisError);
    }
  }

  return {
    status: 'OK',
    message: 'Cart updated successfully',
    data: cart,
  };
};

const countCartByUser = async (userId) => {
  try {
    const cart = await Cart.findOne({ userId });
    if (!cart) return 0;
    return cart.cartItems ? cart.cartItems.length : 0;
  } catch (error) {
    console.error('Error counting cart items:', error.message);
    throw new Error('Failed to count cart items: ' + error.message);
  }
};

module.exports = { createCart, deleteCart, getCartUser, deleteManyCart, updateCart, countCartByUser };
